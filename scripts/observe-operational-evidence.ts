// Isolated observer: GET status only. No database, broker, provider or controls.
import { open, readFile, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CADENCE_MS,
  MAX_JOURNAL_BYTES,
  MAX_SAMPLES,
  chainRecord,
  evidenceSample,
  registration,
  summarizeOperational,
  verifyJournal,
  type EvidenceRecord,
} from "../packages/evaluation/src/operational-evidence.js";

async function syncParent(filename: string) {
  const directory = await open(path.dirname(filename), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function verifyRegistrationFile(
  filename: string,
  records: readonly EvidenceRecord[],
) {
  const anchor = filename + ".registration.json";
  if ((await stat(anchor)).size > 8192)
    throw new Error("OPERATIONAL_REGISTRATION_INVALID");
  const registered = verifyJournal(await readFile(anchor, "utf8"));
  if (registered.length !== 1 || registered[0]?.sha256 !== records[0]?.sha256)
    throw new Error("OPERATIONAL_REGISTRATION_CHANGED");
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 4 && args[0] === "--summary" && args[2] === "--as-of") {
    const filename = path.resolve(args[1]!);
    if ((await stat(filename)).size > MAX_JOURNAL_BYTES)
      throw new Error("OPERATIONAL_JOURNAL_TOO_LARGE");
    const records = verifyJournal(await readFile(filename, "utf8"));
    await verifyRegistrationFile(filename, records);
    console.log(
      JSON.stringify(summarizeOperational(records, args[3]!), null, 2),
    );
    return;
  }
  if (
    args.length !== 6 ||
    args[0] !== "--release" ||
    args[2] !== "--hours" ||
    args[4] !== "--output"
  )
    throw new Error("OPERATIONAL_ARGUMENTS_INVALID");
  const release = args[1]!,
    hours = Number(args[3]),
    filename = path.resolve(args[5]!);
  const initial = registration(release, hours, new Date().toISOString());
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  if (process.env.SCALPER_EVIDENCE_LOCKED !== "1") {
    const child = spawn(
      "flock",
      [
        "--nonblock",
        "--close",
        filename + ".lock",
        process.execPath,
        ...process.execArgv,
        fileURLToPath(import.meta.url),
        ...args,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, SCALPER_EVIDENCE_LOCKED: "1" },
      },
    );
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    if (code !== 0) throw new Error("OPERATIONAL_COLLECTOR_FAILED_OR_LOCKED");
    return;
  }
  let records: EvidenceRecord[];
  try {
    if ((await stat(filename)).size > MAX_JOURNAL_BYTES)
      throw new Error("OPERATIONAL_JOURNAL_TOO_LARGE");
    records = verifyJournal(await readFile(filename, "utf8"));
    const header = records[0]!.payload;
    if (
      header.kind !== "REGISTRATION" ||
      header.release !== release ||
      Date.parse(header.deadline) - Date.parse(header.startedAt) !==
        hours * 3600000
    )
      throw new Error("OPERATIONAL_RESUME_IDENTITY_INVALID");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    const anchor = filename + ".registration.json";
    try {
      await stat(anchor);
      throw new Error("OPERATIONAL_JOURNAL_MISSING", { cause: error });
    } catch (missing) {
      if (
        !(missing instanceof Error) ||
        !("code" in missing) ||
        missing.code !== "ENOENT"
      )
        throw missing;
    }
    records = [chainRecord(initial, null)];
    const registered = await open(anchor, "wx", 0o600);
    try {
      await registered.writeFile(JSON.stringify(records[0]) + "\n");
      await registered.sync();
    } finally {
      await registered.close();
    }
    await syncParent(filename);
    await (await open(filename, "wx", 0o600)).close();
    const first = await open(filename, "a");
    try {
      await first.writeFile(JSON.stringify(records[0]) + "\n");
      await first.sync();
    } finally {
      await first.close();
    }
    await syncParent(filename);
  }
  await verifyRegistrationFile(filename, records);
  const header = records[0]!.payload;
  if (header.kind !== "REGISTRATION")
    throw new Error("OPERATIONAL_REGISTRATION_INVALID");
  const deadline = Date.parse(header.deadline);
  const file = await open(filename, "a");
  let stopping = false;
  const controller = new AbortController();
  const stop = () => {
    stopping = true;
    controller.abort();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    while (!stopping && Date.now() < deadline) {
      let input: unknown = null;
      try {
        const response = await fetch("http://127.0.0.1:8080/v1/status", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (response.ok) {
          const reader = response.body?.getReader();
          if (reader !== undefined) {
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                const chunk: unknown = part.value;
                if (!(chunk instanceof Uint8Array))
                  throw new Error("OPERATIONAL_STATUS_INVALID");
                bytes += chunk.byteLength;
                if (bytes > 256 * 1024)
                  throw new Error("OPERATIONAL_STATUS_TOO_LARGE");
                chunks.push(chunk);
              }
              input = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as unknown;
            } finally {
              await reader.cancel();
            }
          }
        }
      } catch {
        /* Record missing status without raw errors. */
      }
      if (stopping || Date.now() >= deadline) break;
      if (records.length > MAX_SAMPLES)
        throw new Error("OPERATIONAL_JOURNAL_TOO_LARGE");
      const sample = evidenceSample(input, release, new Date().toISOString());
      const record = chainRecord(sample, records.at(-1)!);
      // Verify the new suffix through the same chronology/counter checks as restart.
      const last = records.at(-1)!.payload;
      const lastAt = last.kind === "SAMPLE" ? last.at : header.startedAt;
      if (Date.parse(sample.at) < Date.parse(lastAt))
        throw new Error("OPERATIONAL_CLOCK_INVALID");
      const previousCount = records.findLast(
        (r) => r.payload.kind === "SAMPLE" && r.payload.closedTrades !== null,
      )?.payload;
      if (
        sample.closedTrades !== null &&
        previousCount?.kind === "SAMPLE" &&
        previousCount.closedTrades !== null &&
        sample.closedTrades < previousCount.closedTrades
      )
        throw new Error("OPERATIONAL_COUNTER_REGRESSED");
      const line = JSON.stringify(record) + "\n";
      if (
        (await file.stat()).size + Buffer.byteLength(line) >
        MAX_JOURNAL_BYTES
      )
        throw new Error("OPERATIONAL_JOURNAL_TOO_LARGE");
      await file.writeFile(line);
      await file.sync();
      records.push(record);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          done,
          Math.min(CADENCE_MS, Math.max(0, deadline - Date.now())),
        );
        function done() {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", done);
          resolve();
        }
        controller.signal.addEventListener("abort", done, { once: true });
        if (stopping) done();
      });
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await file.close();
  }
  console.log(
    JSON.stringify(
      summarizeOperational(records, new Date().toISOString()),
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^OPERATIONAL_[A-Z_]+$/.test(error.message)
      ? error.message
      : "OPERATIONAL_EVIDENCE_FAILED",
  );
  process.exitCode = 1;
});
