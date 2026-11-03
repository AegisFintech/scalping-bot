import { Ajv2020 } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
  truncate,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { IdleQuoteRecorder } from "../../apps/market-data-service/src/idle-quote-recorder.js";
import type { FlightQuoteObservation } from "../../packages/contracts/src/flight-quotes.js";
const space = vi.hoisted(() => ({ free: 8 * 1024 ** 3 }));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<object>()),
  statfs: () => Promise.resolve({ bavail: space.free, bsize: 1 }),
}));
const directories: string[] = [];
async function tape() {
  const dir = await mkdtemp(path.join(tmpdir(), "idle-tape-"));
  directories.push(dir);
  return new IdleQuoteRecorder(dir, "XAUUSD", "fixture-source");
}
function event(
  time: string,
  bidUpdated = true,
  askUpdated = true,
): FlightQuoteObservation {
  return {
    kind: "QUOTE",
    symbolName: "XAUUSD",
    bid: "4000",
    ask: "4000.2",
    sourceTime: time,
    receivedAt: time,
    bidUpdated,
    askUpdated,
  };
}
afterEach(async () => {
  space.free = 8 * 1024 ** 3;
  await Promise.all(
    directories.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it("retains idle side clocks, reconnects, original update order and independently verified compressed bytes", async () => {
  const r = await tape();
  const one = "2026-11-03T00:00:00.000Z",
    two = "2026-11-03T00:00:00.100Z";
  r.observe(event(one));
  r.observe(event(two, true, false));
  r.observe({
    ...event(two),
    kind: "RECONNECT",
    symbolName: null,
    bidUpdated: false,
    askUpdated: false,
  });
  r.observe(event("2026-11-03T00:00:00.200Z", false, true));
  await r.stop();
  const names = await readdir(r.directory);
  const file = names.find((n) => n.endsWith(".jsonl.gz"))!;
  const bytes = await readFile(path.join(r.directory, file));
  const raw = gunzipSync(bytes);
  const rows = raw
    .toString()
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s) as Record<string, unknown>);
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const update = ajv.compile(
    JSON.parse(readFileSync("schemas/idle-quote-update-1.0.json", "utf8")),
  );
  for (const row of rows)
    expect(update(row), JSON.stringify(update.errors)).toBe(true);
  expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
  expect(rows[1]).toMatchObject({
    bidSourceTime: two,
    askSourceTime: one,
    askReceivedAt: one,
  });
  expect(rows[3]).toMatchObject({
    bidSourceTime: null,
    bidReceivedAt: null,
    askSourceTime: "2026-11-03T00:00:00.200Z",
  });
  const manifest: unknown = JSON.parse(
    await readFile(path.join(r.directory, file + ".manifest.json"), "utf8"),
  );
  expect(manifest).toMatchObject({
    updates: 4,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uncompressedSha256: createHash("sha256").update(raw).digest("hex"),
    continuousTickTape: false,
    automaticEviction: false,
  });
  const validate = ajv.compile(
    JSON.parse(readFileSync("schemas/idle-quote-manifest-1.0.json", "utf8")),
  );
  expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  expect(r.status).toMatchObject({ persistedUpdates: 4, droppedUpdates: 0 });
});
it("rotates at five minutes and preserves existing segments", async () => {
  const r = await tape();
  r.observe(event("2026-11-03T00:00:00.000Z"));
  r.observe(event("2026-11-03T00:05:00.000Z"));
  await r.stop();
  expect(
    (await readdir(r.directory)).filter((n) => n.endsWith(".jsonl.gz")),
  ).toHaveLength(2);
});
it("latches tape-only storage failure without throwing into ingestion or deleting old evidence", async () => {
  const r = await tape();
  await writeFile(path.join(r.directory, "retain-me"), "evidence");
  space.free = 1024;
  r.observe(event("2026-11-03T00:00:00.000Z"));
  r.observe(event("2026-11-03T00:05:00.000Z"));
  await expect(r.flush()).rejects.toThrow("IDLE_TAPE_CAPACITY");
  expect(r.status).toMatchObject({
    lastError: "IDLE_TAPE_CAPACITY",
    persistedUpdates: 0,
  });
  expect(await readFile(path.join(r.directory, "retain-me"), "utf8")).toBe(
    "evidence",
  );
  r.observe(event("2026-11-03T00:06:00.000Z"));
  expect(r.status.droppedUpdates).toBeGreaterThan(0);
});
it("bounds callback backlog and marks drops instead of allocating without limit", async () => {
  const r = await tape();
  for (let i = 0; i < 2100; i++) r.observe(event("2026-11-03T00:00:00.000Z"));
  expect(r.status.pendingUpdates).toBe(2048);
  expect(r.status.droppedUpdates).toBe(52);
  await r.stop();
});
it("invalidates side provenance even when reconnect is dropped by a full queue", async () => {
  const r = await tape();
  for (let i = 0; i < 2048; i++) r.observe(event("2026-11-03T00:00:00.000Z"));
  r.observe({
    ...event("2026-11-03T00:00:00.050Z"),
    kind: "RECONNECT",
    symbolName: null,
    bidUpdated: false,
    askUpdated: false,
  });
  await r.flush();
  r.observe(event("2026-11-03T00:00:00.100Z", false, true));
  await r.stop();
  const names = (await readdir(r.directory))
    .filter((n) => n.endsWith(".jsonl.gz"))
    .sort();
  const last = gunzipSync(await readFile(path.join(r.directory, names.at(-1)!)))
    .toString()
    .trim();
  expect(JSON.parse(last)).toMatchObject({
    sequence: 2050,
    bidSourceTime: null,
    bidReceivedAt: null,
    askSourceTime: "2026-11-03T00:00:00.100Z",
  });
});
it("counts orphan temporary bytes against capacity without deleting them", async () => {
  const r = await tape();
  const orphan = path.join(r.directory, "idle-orphan.jsonl.gz.tmp");
  await writeFile(orphan, "");
  await truncate(orphan, 257 * 1024 ** 2);
  r.observe(event("2026-11-03T00:00:00.000Z"));
  await expect(r.stop()).rejects.toThrow("IDLE_TAPE_CAPACITY");
  expect((await stat(orphan)).size).toBe(257 * 1024 ** 2);
  expect(r.status.lastError).toBe("IDLE_TAPE_CAPACITY");
});
it("latches first final-write I/O failure in health", async () => {
  const good = await tape();
  const invalid = path.join(good.directory, "file");
  await writeFile(invalid, "occupied");
  const r = new IdleQuoteRecorder(invalid, "XAUUSD", "fixture");
  r.observe(event("2026-11-03T00:00:00.000Z"));
  await expect(r.stop()).rejects.toThrow();
  expect(r.status.lastError).toBe("IDLE_TAPE_IO_FAILURE");
});
