import { spawn, execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  chainRecord,
  registration,
  verifyJournal,
} from "../../packages/evaluation/src/operational-evidence.js";
const run = promisify(execFile),
  release = "0.3.0-fade-limit.3";
const cli = "scripts/observe-operational-evidence.ts";
const args = (file: string, hours = "1") => [
  "--import",
  "tsx",
  cli,
  "--release",
  release,
  "--hours",
  hours,
  "--output",
  file,
];
async function fixture(until: number = Date.now() - 1000) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "operational-evidence-test-"),
  );
  const file = path.join(directory, "journal.jsonl");
  const header = chainRecord(
    registration(release, 1, new Date(until - 3600000).toISOString()),
    null,
  );
  const content = JSON.stringify(header) + "\n";
  await writeFile(file, content, { mode: 0o600 });
  await writeFile(file + ".registration.json", content, { mode: 0o600 });
  return { directory, file, content };
}
it("resumes an elapsed journal without changing registration, deadline or bytes", async () => {
  const f = await fixture();
  try {
    const r = await run(process.execPath, args(f.file));
    expect(JSON.parse(r.stdout)).toMatchObject({
      samples: 0,
      collectionWindowElapsed: true,
      qualification: "UNQUALIFIED",
    });
    expect(await readFile(f.file, "utf8")).toBe(f.content);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
it("rejects corrupt crash tails and resume duration mismatch without repairing history", async () => {
  const f = await fixture();
  try {
    await expect(
      run(process.execPath, args(f.file, "2")),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "OPERATIONAL_RESUME_IDENTITY_INVALID",
      ) as unknown,
    });
    await writeFile(f.file, f.content + "{partial");
    await expect(run(process.execPath, args(f.file))).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "OPERATIONAL_JOURNAL_INCOMPLETE",
      ) as unknown,
    });
    expect(await readFile(f.file, "utf8")).toBe(f.content + "{partial");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
it("rejects a concurrent writer using the OS lock and preserves the original bytes", async () => {
  const f = await fixture();
  const holder = spawn(
    "flock",
    [
      "--no-fork",
      f.file + ".lock",
      process.execPath,
      "-e",
      "process.stdout.write('locked');setTimeout(()=>{},10000)",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      holder.stdout.once("data", () => resolve());
      holder.once("error", reject);
      holder.once("exit", () => reject(new Error("LOCK_HOLDER_EXITED")));
    });
    await expect(run(process.execPath, args(f.file))).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "OPERATIONAL_COLLECTOR_FAILED_OR_LOCKED",
      ) as unknown,
    });
    expect(await readFile(f.file, "utf8")).toBe(f.content);
  } finally {
    holder.kill("SIGTERM");
    await new Promise<void>((resolve) => holder.once("exit", () => resolve()));
    await rm(f.directory, { recursive: true, force: true });
  }
});
it("collects mocked status, fsyncs a linked sample and resumes without duplicate writes", async () => {
  const f = await fixture(Date.now() + 5000);
  try {
    const mock = path.join(f.directory, "mock.mjs");
    await writeFile(
      mock,
      `globalThis.fetch=async()=>{const at=new Date().toISOString();return new Response(JSON.stringify({mode:'demo',strategyVersion:'${release}',startupChecksPassed:true,operationalReady:true,tradingEnabled:true,automaticDemoTradeCampaign:{releaseClosedTrades:2},managedSetup:{status:'LATEST_TERMINAL'},reasonCodes:[],marketSession:{state:'OPEN',checkedAt:at,scheduleFetchedAt:at,reasonCode:null}}));};`,
    );
    const r = await run(process.execPath, ["--import", mock, ...args(f.file)], {
      timeout: 10000,
    });
    expect(JSON.parse(r.stdout)).toMatchObject({
      samples: 1,
      collectionWindowElapsed: true,
      sampledOpenMs: 0,
    });
    const content = await readFile(f.file, "utf8");
    expect(verifyJournal(content)).toHaveLength(2);
    await run(process.execPath, args(f.file));
    expect(await readFile(f.file, "utf8")).toBe(content);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 15000);
it("redacts invalid CLI and JSON errors instead of echoing inputs or file contents", async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, "sensitive-fixture-placeholder\n");
    await expect(run(process.execPath, args(f.file))).rejects.toMatchObject({
      stderr: expect.stringContaining("OPERATIONAL_EVIDENCE_FAILED") as unknown,
    });
    await expect(
      run(process.execPath, ["--import", "tsx", cli, "invalid"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "OPERATIONAL_ARGUMENTS_INVALID",
      ) as unknown,
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("never resets a missing journal when its independent registration survives", async () => {
  const f = await fixture();
  try {
    await rm(f.file);
    await expect(run(process.execPath, args(f.file))).rejects.toMatchObject({
      stderr: expect.stringContaining("OPERATIONAL_JOURNAL_MISSING") as unknown,
    });
    expect(await readFile(f.file + ".registration.json", "utf8")).toBe(
      f.content,
    );
    await expect(readFile(f.file)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
it("rejects a recomputed registration that disagrees with its separately retained anchor", async () => {
  const f = await fixture();
  try {
    const header = chainRecord(
      registration(release, 1, new Date(Date.now() - 7200000).toISOString()),
      null,
    );
    await writeFile(f.file, JSON.stringify(header) + "\n");
    await expect(run(process.execPath, args(f.file))).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "OPERATIONAL_REGISTRATION_CHANGED",
      ) as unknown,
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("bounds streamed status bytes and retains an unavailable sample", async () => {
  const f = await fixture(Date.now() + 5000);
  try {
    const mock = path.join(f.directory, "oversized.mjs");
    await writeFile(
      mock,
      "globalThis.fetch=async()=>new Response('x'.repeat(300000));",
    );
    const r = await run(process.execPath, ["--import", mock, ...args(f.file)], {
      timeout: 10000,
    });
    expect(JSON.parse(r.stdout)).toMatchObject({
      samples: 1,
      unavailableSamples: 1,
      sampledOpenMs: 0,
    });
    expect(verifyJournal(await readFile(f.file, "utf8"))).toHaveLength(2);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 15000);
