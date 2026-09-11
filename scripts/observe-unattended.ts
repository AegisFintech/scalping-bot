// Read-only, sampled service observation. This never enables or submits trading.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const reason = z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/);
const validObservation = z
  .object({
    available: z.literal(true),
    startupReady: z.boolean(),
    operationalReady: z.boolean(),
    tradingEnabled: z.boolean(),
    setup: reason,
    releaseClosedTrades: z.number().int().nonnegative(),
    reasons: z.array(reason),
  })
  .strict();
const unavailableObservation = z
  .object({ available: z.literal(false), reasons: z.array(reason) })
  .strict();
const observationSchema = z.union([validObservation, unavailableObservation]);
export type Observation = z.infer<typeof observationSchema>;
const counterSchema = z.object({
  lastSampleAt: z.iso.datetime(),
  samples: z.number().int().nonnegative(),
  unavailableSamples: z.number().int().nonnegative(),
  notReadySamples: z.number().int().nonnegative(),
  samplingGaps: z.number().int().nonnegative(),
  maximumClosedTrades: z.number().int().nonnegative().nullable(),
  latest: observationSchema.nullable(),
  transitions: z
    .array(
      z.union([
        validObservation.extend({ at: z.iso.datetime() }),
        unavailableObservation.extend({ at: z.iso.datetime() }),
      ]),
    )
    .max(64),
});
export type ObservationCounters = z.infer<typeof counterSchema>;
export const checkpointSchema = counterSchema
  .extend({
    schemaVersion: z.literal(1),
    mode: z.literal("demo"),
    release: z.string(),
    startedAt: z.iso.datetime(),
    deadline: z.iso.datetime(),
    complete: z.boolean(),
  })
  .strict();
const statusSchema = z.object({
  mode: z.literal("demo"),
  strategyVersion: z.string(),
  startupChecksPassed: z.boolean(),
  operationalReady: z.boolean(),
  tradingEnabled: z.boolean(),
  automaticDemoTradeCampaign: z.object({
    releaseClosedTrades: z.number().int().nonnegative(),
  }),
  managedSetup: z.object({ status: reason }),
  reasonCodes: z.array(reason),
});

export function observation(input: unknown, release: string): Observation {
  const identity = z
    .object({ mode: z.literal("demo"), strategyVersion: z.literal(release) })
    .safeParse(input);
  if (!identity.success)
    return { available: false, reasons: ["OBSERVATION_IDENTITY_MISMATCH"] };
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success)
    return { available: false, reasons: ["OBSERVATION_STATUS_INVALID"] };
  const status = parsed.data;
  return {
    available: true,
    startupReady: status.startupChecksPassed,
    operationalReady: status.operationalReady,
    tradingEnabled: status.tradingEnabled,
    setup: status.managedSetup.status,
    releaseClosedTrades: status.automaticDemoTradeCampaign.releaseClosedTrades,
    reasons: [...new Set(status.reasonCodes)].sort(),
  };
}

export function accumulate(
  previous: ObservationCounters,
  sample: Observation,
  at: string,
): ObservationCounters {
  const delta = (Date.parse(at) - Date.parse(previous.lastSampleAt)) / 1000;
  if (!Number.isFinite(delta) || delta < 0)
    throw new Error("OBSERVATION_CLOCK_INVALID");
  const regression =
    sample.available &&
    previous.maximumClosedTrades !== null &&
    sample.releaseClosedTrades < previous.maximumClosedTrades;
  const current: Observation = regression
    ? { available: false, reasons: ["OBSERVATION_COUNTER_REGRESSED"] }
    : sample;
  const faults =
    current.available && current.startupReady && current.operationalReady
      ? 0
      : 1;
  const transition =
    JSON.stringify(current) !== JSON.stringify(previous.latest);
  return {
    ...previous,
    lastSampleAt: at,
    samples: previous.samples + 1,
    unavailableSamples:
      previous.unavailableSamples + (current.available ? 0 : 1),
    notReadySamples: previous.notReadySamples + faults,
    samplingGaps: previous.samplingGaps + (delta > 45 ? 1 : 0),
    maximumClosedTrades: current.available
      ? current.releaseClosedTrades
      : previous.maximumClosedTrades,
    latest: current,
    transitions: transition
      ? [...previous.transitions, { at, ...current }].slice(-64)
      : previous.transitions,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (
    args.length !== 6 ||
    args[0] !== "--release" ||
    args[2] !== "--hours" ||
    args[4] !== "--output"
  )
    throw new Error("OBSERVATION_ARGUMENTS_INVALID");
  const release = args[1]!;
  const hours = Number(args[3]);
  if (
    !/^0\.[0-9]+\.[0-9]+-market-stop\.[0-9]+$/.test(release) ||
    !Number.isFinite(hours) ||
    hours < 1 ||
    hours > 168
  )
    throw new Error("OBSERVATION_ARGUMENTS_INVALID");
  const output = path.resolve(args[5]!);
  const at = new Date().toISOString();
  let state: z.infer<typeof checkpointSchema> = {
    schemaVersion: 1,
    mode: "demo",
    release,
    startedAt: at,
    deadline: new Date(Date.now() + hours * 3600000).toISOString(),
    lastSampleAt: at,
    samples: 0,
    unavailableSamples: 0,
    notReadySamples: 0,
    samplingGaps: 0,
    maximumClosedTrades: null,
    latest: null,
    transitions: [],
    complete: false,
  };
  try {
    const saved = checkpointSchema.parse(
      JSON.parse(await readFile(output, "utf8")) as unknown,
    );
    if (saved.release !== release)
      throw new Error("OBSERVATION_CHECKPOINT_INVALID");
    state = saved;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw new Error("OBSERVATION_CHECKPOINT_INVALID", { cause: error });
  }
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  while (!state.complete) {
    let sample: Observation;
    try {
      const response = await fetch("http://127.0.0.1:8080/v1/status", {
        signal: AbortSignal.timeout(10000),
      });
      sample = response.ok
        ? observation(await response.json(), release)
        : { available: false, reasons: ["OBSERVATION_STATUS_UNAVAILABLE"] };
    } catch {
      sample = {
        available: false,
        reasons: ["OBSERVATION_STATUS_UNAVAILABLE"],
      };
    }
    state = {
      ...state,
      ...accumulate(state, sample, new Date().toISOString()),
    };
    state.complete = Date.now() >= Date.parse(state.deadline);
    await writeFile(`${output}.tmp`, JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(`${output}.tmp`, output);
    if (!state.complete)
      await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  console.log(
    JSON.stringify({
      complete: true,
      samples: state.samples,
      notReadySamples: state.notReadySamples,
      unavailableSamples: state.unavailableSamples,
      samplingGaps: state.samplingGaps,
      productionCertified: false,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error("UNATTENDED_OBSERVATION_FAILED");
    process.exitCode = 1;
  });
