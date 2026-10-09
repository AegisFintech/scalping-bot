import { createHash } from "node:crypto";
import { z } from "zod";
import { observation } from "../../../scripts/observe-unattended.js";
import { POLICY_VERSION } from "../../config/src/policy.js";

export const MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
export const MAX_SAMPLES = 40321;
export const CADENCE_MS = 15000;
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/);
export const registrationSchema = z
  .object({
    kind: z.literal("REGISTRATION"),
    version: z.literal("operational-evidence-1.0"),
    mode: z.literal("demo"),
    release: z.literal(POLICY_VERSION),
    startedAt: z.iso.datetime(),
    deadline: z.iso.datetime(),
    cadenceMs: z.literal(CADENCE_MS),
  })
  .strict();
export const sampleSchema = z
  .object({
    kind: z.literal("SAMPLE"),
    at: z.iso.datetime(),
    available: z.boolean(),
    startupReady: z.boolean().nullable(),
    operationalReady: z.boolean().nullable(),
    tradingEnabled: z.boolean().nullable(),
    closedTrades: z.number().int().nonnegative().nullable(),
    reasons: z.array(reason).max(128),
    session: z.enum(["OPEN", "CLOSED", "UNAVAILABLE"]),
    sessionCheckedAt: z.iso.datetime().nullable(),
    scheduleFetchedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const recordSchema = z
  .object({
    sequence: z.number().int().min(0).max(MAX_SAMPLES),
    previousSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    payload: z.union([registrationSchema, sampleSchema]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type EvidenceRecord = z.infer<typeof recordSchema>;
export type EvidenceSample = z.infer<typeof sampleSchema>;
export type Registration = z.infer<typeof registrationSchema>;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function registration(
  release: string,
  hours: number,
  at: string,
): Registration {
  if (
    release !== POLICY_VERSION ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 168
  )
    throw new Error("OPERATIONAL_ARGUMENTS_INVALID");
  return registrationSchema.parse({
    kind: "REGISTRATION",
    version: "operational-evidence-1.0",
    mode: "demo",
    release,
    startedAt: at,
    deadline: new Date(Date.parse(at) + hours * 3600000).toISOString(),
    cadenceMs: CADENCE_MS,
  });
}
export function evidenceSample(
  input: unknown,
  release: string,
  at: string,
): EvidenceSample {
  const base =
    input === null
      ? {
          available: false as const,
          reasons: ["OBSERVATION_STATUS_UNAVAILABLE"],
        }
      : observation(input, release);
  const parsed = z
    .object({
      marketSession: z
        .object({
          state: z.enum(["OPEN", "CLOSED", "UNAVAILABLE"]),
          checkedAt: z.iso.datetime(),
          scheduleFetchedAt: z.iso.datetime().nullable(),
          reasonCode: z
            .enum(["MARKET_SESSION_CLOSED", "MARKET_SESSION_UNAVAILABLE"])
            .nullable(),
        })
        .strict(),
    })
    .safeParse(input);
  const s = parsed.success ? parsed.data.marketSession : null;
  const now = Date.parse(at),
    checked = s === null ? NaN : Date.parse(s.checkedAt),
    fetched =
      s?.scheduleFetchedAt === null || s === null
        ? NaN
        : Date.parse(s.scheduleFetchedAt);
  const fresh =
    base.available &&
    s !== null &&
    checked <= now &&
    now - checked <= 10000 &&
    fetched <= checked &&
    now - fetched < 30000 &&
    ((s.state === "OPEN" && s.reasonCode === null) ||
      (s.state === "CLOSED" && s.reasonCode === "MARKET_SESSION_CLOSED"));
  return sampleSchema.parse({
    kind: "SAMPLE",
    at,
    available: base.available,
    startupReady: base.available ? base.startupReady : null,
    operationalReady: base.available ? base.operationalReady : null,
    tradingEnabled: base.available ? base.tradingEnabled : null,
    closedTrades: base.available ? base.releaseClosedTrades : null,
    reasons: base.reasons,
    session: fresh ? s.state : "UNAVAILABLE",
    sessionCheckedAt: s?.checkedAt ?? null,
    scheduleFetchedAt: s?.scheduleFetchedAt ?? null,
  });
}
export function chainRecord(
  payload: Registration | EvidenceSample,
  previous: EvidenceRecord | null,
): EvidenceRecord {
  const body = {
    sequence: previous === null ? 0 : previous.sequence + 1,
    previousSha256: previous?.sha256 ?? null,
    payload,
  };
  return recordSchema.parse({ ...body, sha256: digest(body) });
}
export function verifyJournal(content: string): EvidenceRecord[] {
  if (Buffer.byteLength(content) > MAX_JOURNAL_BYTES)
    throw new Error("OPERATIONAL_JOURNAL_TOO_LARGE");
  if (!content.endsWith("\n"))
    throw new Error("OPERATIONAL_JOURNAL_INCOMPLETE");
  const lines = content.slice(0, -1).split("\n");
  if (lines.length > MAX_SAMPLES + 1)
    throw new Error("OPERATIONAL_JOURNAL_TOO_LARGE");
  const records = lines.map((line) =>
    recordSchema.parse(JSON.parse(line) as unknown),
  );
  const header = records[0]?.payload;
  if (header?.kind !== "REGISTRATION")
    throw new Error("OPERATIONAL_REGISTRATION_INVALID");
  const duration = Date.parse(header.deadline) - Date.parse(header.startedAt);
  if (
    duration < 3600000 ||
    duration > 168 * 3600000 ||
    duration % 3600000 !== 0
  )
    throw new Error("OPERATIONAL_REGISTRATION_INVALID");
  let previous: EvidenceRecord | null = null;
  let at = Date.parse(header.startedAt),
    maxClosed: number | null = null;
  for (const record of records) {
    if (
      JSON.stringify(chainRecord(record.payload, previous)) !==
      JSON.stringify(record)
    )
      throw new Error("OPERATIONAL_INTEGRITY_INVALID");
    if (previous !== null) {
      if (record.payload.kind !== "SAMPLE")
        throw new Error("OPERATIONAL_REGISTRATION_INVALID");
      const sample = record.payload,
        time = Date.parse(sample.at);
      if (time < at || time >= Date.parse(header.deadline))
        throw new Error("OPERATIONAL_CLOCK_INVALID");
      if (
        sample.closedTrades !== null &&
        maxClosed !== null &&
        sample.closedTrades < maxClosed
      )
        throw new Error("OPERATIONAL_COUNTER_REGRESSED");
      if (sample.closedTrades !== null) maxClosed = sample.closedTrades;
      at = time;
    }
    previous = record;
  }
  return records;
}
export const summarySchema = z
  .object({
    reportVersion: z.literal("operational-evidence-summary-1.0"),
    mode: z.literal("demo"),
    release: z.literal(POLICY_VERSION),
    startedAt: z.iso.datetime(),
    deadline: z.iso.datetime(),
    asOf: z.iso.datetime(),
    lastSampleAt: z.iso.datetime().nullable(),
    samples: z.number().int().min(0).max(MAX_SAMPLES),
    unavailableSamples: z.number().int().nonnegative(),
    notReadySamples: z.number().int().nonnegative(),
    gapIntervals: z.number().int().nonnegative(),
    sampledOpenMs: z.number().int().nonnegative(),
    sampledReadyOpenMs: z.number().int().nonnegative(),
    coverageBasis: z.literal(
      "ADJACENT_FRESH_SAMPLES_NOT_CONTINUOUS_UPTIME_OR_BROKER_CALENDAR_PROOF",
    ),
    journalSha256: z.string().regex(/^[a-f0-9]{64}$/),
    collectionWindowElapsed: z.boolean(),
    brokerAuthority: z.literal(false),
    promotionAuthority: z.literal(false),
    brokerCalendarVerifiedHours: z.null(),
    protectedCycles: z.null(),
    alertReceipt: z.null(),
    currentRestore: z.null(),
    qualification: z.literal("UNQUALIFIED"),
  })
  .strict();
export function summarizeOperational(
  records: readonly EvidenceRecord[],
  asOf: string,
) {
  const checked = verifyJournal(
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  const header = checked[0]!.payload as Registration;
  const samples = checked.slice(1).map((r) => r.payload as EvidenceSample);
  const now = Date.parse(z.iso.datetime().parse(asOf));
  if (now < Date.parse(samples.at(-1)?.at ?? header.startedAt))
    throw new Error("OPERATIONAL_AS_OF_INVALID");
  let sampledOpenMs = 0,
    sampledReadyOpenMs = 0,
    gaps = 0;
  const validOpen = (s: EvidenceSample) =>
    s.available &&
    s.session === "OPEN" &&
    s.sessionCheckedAt !== null &&
    s.scheduleFetchedAt !== null &&
    Date.parse(s.sessionCheckedAt) <= Date.parse(s.at) &&
    Date.parse(s.at) - Date.parse(s.sessionCheckedAt) <= 10000 &&
    Date.parse(s.scheduleFetchedAt) <= Date.parse(s.sessionCheckedAt) &&
    Date.parse(s.at) - Date.parse(s.scheduleFetchedAt) < 30000;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!,
      b = samples[i]!,
      delta = Date.parse(b.at) - Date.parse(a.at);
    if (delta > 45000) {
      gaps++;
      continue;
    }
    if (validOpen(a) && validOpen(b)) {
      sampledOpenMs += delta;
      if (
        a.startupReady &&
        a.operationalReady &&
        b.startupReady &&
        b.operationalReady
      )
        sampledReadyOpenMs += delta;
    }
  }
  return summarySchema.parse({
    reportVersion: "operational-evidence-summary-1.0" as const,
    mode: "demo" as const,
    release: header.release,
    startedAt: header.startedAt,
    deadline: header.deadline,
    asOf,
    lastSampleAt: samples.at(-1)?.at ?? null,
    samples: samples.length,
    unavailableSamples: samples.filter((s) => !s.available).length,
    notReadySamples: samples.filter(
      (s) => !s.available || !s.startupReady || !s.operationalReady,
    ).length,
    gapIntervals: gaps,
    sampledOpenMs,
    sampledReadyOpenMs,
    coverageBasis:
      "ADJACENT_FRESH_SAMPLES_NOT_CONTINUOUS_UPTIME_OR_BROKER_CALENDAR_PROOF" as const,
    journalSha256: checked.at(-1)!.sha256,
    collectionWindowElapsed: now >= Date.parse(header.deadline),
    brokerAuthority: false as const,
    promotionAuthority: false as const,
    brokerCalendarVerifiedHours: null,
    protectedCycles: null,
    alertReceipt: null,
    currentRestore: null,
    qualification: "UNQUALIFIED" as const,
  });
}
