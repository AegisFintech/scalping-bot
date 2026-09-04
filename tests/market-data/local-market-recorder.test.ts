import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalMarketRecorder,
  type LocalMarketSample,
} from "../../apps/market-data-service/src/local-market-recorder.js";

const gunzipAsync = promisify(gunzip);
const temporaryDirectories: string[] = [];

function sample(capturedAt: string): LocalMarketSample {
  return {
    schemaVersion: "1.0",
    symbol: "XAUUSD",
    capturedAt,
    quote: {
      bid: "4499.99",
      ask: "4500.01",
      sourceTime: capturedAt,
      receivedAt: capturedAt,
    },
    orderBook: {
      sourceTime: capturedAt,
      receivedAt: capturedAt,
      bids: [{ price: "4499.99", size: "2" }],
      asks: [{ price: "4500.01", size: "3" }],
      complete: true,
      discontinuity: false,
      reconnectSequence: 0,
      aggregates: [],
    },
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "market-recorder-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local market recorder", () => {
  it("progressively writes and closes checksummed compressed segments", async () => {
    const directory = await temporaryDirectory();
    const recorder = new LocalMarketRecorder({
      directory,
      sampleIntervalMs: 250,
      segmentDurationSeconds: 1,
      maxCompletedSegments: 10,
    });
    recorder.record(sample("2026-09-04T00:00:00.100Z"));
    recorder.record(sample("2026-09-04T00:00:01.100Z"));
    await recorder.stop();

    const files = await readdir(directory);
    const segments = files.filter((file) => file.endsWith(".jsonl.gz"));
    expect(segments).toHaveLength(2);
    expect(
      files.filter((file) => file.endsWith(".manifest.json")),
    ).toHaveLength(2);
    const body = (
      await gunzipAsync(await readFile(path.join(directory, segments[0]!)))
    ).toString("utf8");
    expect(JSON.parse(body.trim())).toMatchObject({
      schemaVersion: "1.0",
      symbol: "XAUUSD",
      quote: { bid: "4499.99", ask: "4500.01" },
    });
    expect(recorder.status).toMatchObject({
      samplesWritten: 2,
      samplesDropped: 0,
      segmentsCompleted: 2,
      currentSegmentFile: null,
    });
  });

  it("retains only the configured number of completed segments", async () => {
    const directory = await temporaryDirectory();
    const recorder = new LocalMarketRecorder({
      directory,
      sampleIntervalMs: 250,
      segmentDurationSeconds: 1,
      maxCompletedSegments: 1,
    });
    recorder.record(sample("2026-09-04T00:00:00.100Z"));
    recorder.record(sample("2026-09-04T00:00:01.100Z"));
    recorder.record(sample("2026-09-04T00:00:02.100Z"));
    await recorder.stop();
    const files = await readdir(directory);
    expect(files.filter((file) => file.endsWith(".jsonl.gz"))).toHaveLength(1);
    expect(
      files.filter((file) => file.endsWith(".manifest.json")),
    ).toHaveLength(1);
  });

  it("reports an I/O failure without throwing into market ingestion", async () => {
    const directory = await temporaryDirectory();
    const invalidDirectory = path.join(directory, "not-a-directory");
    await writeFile(invalidDirectory, "occupied", { mode: 0o600 });
    const recorder = new LocalMarketRecorder({
      directory: invalidDirectory,
      sampleIntervalMs: 250,
      segmentDurationSeconds: 60,
      maxCompletedSegments: 10,
    });
    recorder.record(sample("2026-09-04T00:00:00.100Z"));
    await recorder.flush();
    expect(recorder.status).toMatchObject({
      healthy: false,
      samplesWritten: 0,
      samplesDropped: 1,
      lastErrorCode: "LOCAL_MARKET_RECORDER_IO_FAILED",
    });
  });

  it("drops invalid market evidence instead of persisting it", async () => {
    const directory = await temporaryDirectory();
    const recorder = new LocalMarketRecorder({
      directory,
      sampleIntervalMs: 250,
      segmentDurationSeconds: 60,
      maxCompletedSegments: 10,
    });
    const invalid = sample("2026-09-04T00:00:00.100Z");
    recorder.record({
      ...invalid,
      quote: { ...invalid.quote, ask: invalid.quote.bid },
    });
    await recorder.flush();
    expect(recorder.status).toMatchObject({
      healthy: false,
      samplesWritten: 0,
      samplesDropped: 1,
      lastErrorCode: "LOCAL_MARKET_SAMPLE_PRICE_INVALID",
    });
    expect(await readdir(directory).catch(() => [])).toEqual([]);
  });
});
