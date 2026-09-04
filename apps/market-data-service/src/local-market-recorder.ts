import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { Decimal } from "decimal.js";

import type {
  OrderBookSnapshot,
  Quote,
} from "../../../packages/contracts/src/index.js";

const gzipAsync = promisify(gzip);
const COMPLETED_SEGMENT =
  /^market-[a-z0-9._-]+-\d{8}T\d{6}Z-[a-f0-9-]+\.jsonl\.gz$/;

export interface LocalMarketSample {
  readonly schemaVersion: "1.0";
  readonly symbol: string;
  readonly capturedAt: string;
  readonly quote: Quote;
  readonly orderBook: OrderBookSnapshot;
}

export interface LocalMarketRecorderStatus {
  readonly enabled: true;
  readonly healthy: boolean;
  readonly format: "jsonl+gzip";
  readonly sampleIntervalMs: number;
  readonly segmentDurationSeconds: number;
  readonly maxCompletedSegments: number;
  readonly samplesWritten: number;
  readonly samplesDropped: number;
  readonly pendingSamples: number;
  readonly segmentsCompleted: number;
  readonly compressedBytesWritten: number;
  readonly lastSampleAt: string | null;
  readonly currentSegmentStartedAt: string | null;
  readonly currentSegmentFile: string | null;
  readonly lastErrorCode: string | null;
}

export interface LocalMarketRecorderOptions {
  readonly directory: string;
  readonly sampleIntervalMs: number;
  readonly segmentDurationSeconds: number;
  readonly maxCompletedSegments: number;
}

function safeSymbol(symbol: string): string {
  if (!/^[A-Z0-9._-]{1,32}$/.test(symbol))
    throw new Error("LOCAL_MARKET_SAMPLE_SYMBOL_INVALID");
  return symbol.toLowerCase();
}

function dateMs(value: string, reason: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error(reason);
  return parsed;
}

function validateSample(sample: LocalMarketSample): number {
  safeSymbol(sample.symbol);
  const capturedAt = dateMs(
    sample.capturedAt,
    "LOCAL_MARKET_SAMPLE_CAPTURE_TIME_INVALID",
  );
  dateMs(sample.quote.sourceTime, "LOCAL_MARKET_SAMPLE_QUOTE_TIME_INVALID");
  dateMs(sample.quote.receivedAt, "LOCAL_MARKET_SAMPLE_QUOTE_TIME_INVALID");
  dateMs(sample.orderBook.sourceTime, "LOCAL_MARKET_SAMPLE_BOOK_TIME_INVALID");
  dateMs(sample.orderBook.receivedAt, "LOCAL_MARKET_SAMPLE_BOOK_TIME_INVALID");
  if (!sample.orderBook.complete || sample.orderBook.discontinuity)
    throw new Error("LOCAL_MARKET_SAMPLE_BOOK_INCOMPLETE");
  const bid = new Decimal(sample.quote.bid);
  const ask = new Decimal(sample.quote.ask);
  if (
    !bid.isFinite() ||
    !ask.isFinite() ||
    bid.lte(0) ||
    ask.lte(bid) ||
    sample.orderBook.bids.length < 1 ||
    sample.orderBook.asks.length < 1 ||
    sample.orderBook.bids.length > 200 ||
    sample.orderBook.asks.length > 200
  ) {
    throw new Error("LOCAL_MARKET_SAMPLE_PRICE_INVALID");
  }
  for (const level of [...sample.orderBook.bids, ...sample.orderBook.asks]) {
    const price = new Decimal(level.price);
    const size = new Decimal(level.size);
    if (!price.isFinite() || !size.isFinite() || price.lte(0) || size.lte(0))
      throw new Error("LOCAL_MARKET_SAMPLE_DEPTH_INVALID");
  }
  return capturedAt;
}

function stableError(error: unknown): string {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_:-]{1,160}$/.test(message)
    ? message
    : "LOCAL_MARKET_RECORDER_IO_FAILED";
}

export class LocalMarketRecorder {
  readonly #options: LocalMarketRecorderOptions;
  readonly #directory: string;
  #queue: Promise<void> = Promise.resolve();
  #stopped = false;
  #segmentBucket: number | null = null;
  #segmentStartedAt: string | null = null;
  #segmentPath: string | null = null;
  #segmentSamples = 0;
  #samplesWritten = 0;
  #samplesDropped = 0;
  #pendingSamples = 0;
  #segmentsCompleted = 0;
  #compressedBytesWritten = 0;
  #lastSampleAt: string | null = null;
  #lastErrorCode: string | null = null;

  constructor(options: LocalMarketRecorderOptions) {
    if (
      options.directory.trim() === "" ||
      !Number.isSafeInteger(options.sampleIntervalMs) ||
      options.sampleIntervalMs < 100 ||
      !Number.isSafeInteger(options.segmentDurationSeconds) ||
      options.segmentDurationSeconds < 1 ||
      !Number.isSafeInteger(options.maxCompletedSegments) ||
      options.maxCompletedSegments < 1
    ) {
      throw new Error("LOCAL_MARKET_RECORDER_CONFIG_INVALID");
    }
    const resolved = path.resolve(options.directory);
    if (resolved === path.parse(resolved).root)
      throw new Error("LOCAL_MARKET_RECORDER_DIRECTORY_UNSAFE");
    this.#options = options;
    this.#directory = resolved;
  }

  get status(): LocalMarketRecorderStatus {
    return {
      enabled: true,
      healthy: this.#lastErrorCode === null && !this.#stopped,
      format: "jsonl+gzip",
      sampleIntervalMs: this.#options.sampleIntervalMs,
      segmentDurationSeconds: this.#options.segmentDurationSeconds,
      maxCompletedSegments: this.#options.maxCompletedSegments,
      samplesWritten: this.#samplesWritten,
      samplesDropped: this.#samplesDropped,
      pendingSamples: this.#pendingSamples,
      segmentsCompleted: this.#segmentsCompleted,
      compressedBytesWritten: this.#compressedBytesWritten,
      lastSampleAt: this.#lastSampleAt,
      currentSegmentStartedAt: this.#segmentStartedAt,
      currentSegmentFile:
        this.#segmentPath === null ? null : path.basename(this.#segmentPath),
      lastErrorCode: this.#lastErrorCode,
    };
  }

  record(sample: LocalMarketSample): void {
    if (this.#stopped) {
      this.#samplesDropped += 1;
      this.#lastErrorCode = "LOCAL_MARKET_RECORDER_STOPPED";
      return;
    }
    if (this.#pendingSamples >= 1_000) {
      this.#samplesDropped += 1;
      this.#lastErrorCode = "LOCAL_MARKET_RECORDER_QUEUE_FULL";
      return;
    }
    this.#pendingSamples += 1;
    this.#queue = this.#queue
      .then(() => this.#writeSample(sample))
      .catch((error: unknown) => {
        this.#samplesDropped += 1;
        this.#lastErrorCode = stableError(error);
      })
      .finally(() => {
        this.#pendingSamples -= 1;
      });
  }

  noteCaptureFailure(reason: string): void {
    this.#samplesDropped += 1;
    this.#lastErrorCode = /^[A-Z0-9_:-]{1,160}$/.test(reason)
      ? reason
      : "LOCAL_MARKET_CAPTURE_FAILED";
  }

  async flush(): Promise<void> {
    await this.#queue;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#queue;
    try {
      await this.#completeSegment();
    } catch (error) {
      this.#lastErrorCode = stableError(error);
    }
  }

  async #writeSample(sample: LocalMarketSample): Promise<void> {
    const capturedAtMs = validateSample(sample);
    const segmentMs = this.#options.segmentDurationSeconds * 1_000;
    const bucket = Math.floor(capturedAtMs / segmentMs) * segmentMs;
    if (this.#segmentBucket !== null && bucket !== this.#segmentBucket)
      await this.#completeSegment();
    if (this.#segmentPath === null) {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      const startedAt = new Date(bucket).toISOString();
      const stamp = startedAt
        .replaceAll("-", "")
        .replaceAll(":", "")
        .replace(".000", "");
      const file = `market-${safeSymbol(sample.symbol)}-${stamp}-${randomUUID()}.ndjson`;
      this.#segmentBucket = bucket;
      this.#segmentStartedAt = startedAt;
      this.#segmentPath = path.join(this.#directory, file);
      this.#segmentSamples = 0;
    }
    await appendFile(this.#segmentPath, `${JSON.stringify(sample)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    this.#segmentSamples += 1;
    this.#samplesWritten += 1;
    this.#lastSampleAt = sample.capturedAt;
    this.#lastErrorCode = null;
  }

  async #completeSegment(): Promise<void> {
    if (this.#segmentPath === null || this.#segmentStartedAt === null) return;
    const sourcePath = this.#segmentPath;
    const sampleCount = this.#segmentSamples;
    const startedAt = this.#segmentStartedAt;
    const completedAt = this.#lastSampleAt;
    const compressedPath = sourcePath.replace(/\.ndjson$/, ".jsonl.gz");
    const temporaryPath = `${compressedPath}.${randomUUID()}.tmp`;
    const source = await readFile(sourcePath);
    const compressed = await gzipAsync(source, { level: 9 });
    await writeFile(temporaryPath, compressed, { mode: 0o600 });
    await rename(temporaryPath, compressedPath);
    const sha256 = createHash("sha256").update(compressed).digest("hex");
    const manifestPath = `${compressedPath}.manifest.json`;
    const temporaryManifestPath = `${manifestPath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryManifestPath,
      `${JSON.stringify({
        schemaVersion: "1.0",
        file: path.basename(compressedPath),
        sha256,
        sampleCount,
        startedAt,
        completedAt,
        compressedBytes: compressed.byteLength,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryManifestPath, manifestPath);
    await unlink(sourcePath);
    this.#segmentsCompleted += 1;
    this.#compressedBytesWritten += compressed.byteLength;
    this.#segmentBucket = null;
    this.#segmentStartedAt = null;
    this.#segmentPath = null;
    this.#segmentSamples = 0;
    await this.#enforceRetention();
  }

  async #enforceRetention(): Promise<void> {
    const entries = (await readdir(this.#directory))
      .filter((name) => COMPLETED_SEGMENT.test(name))
      .sort();
    const remove = entries.slice(
      0,
      Math.max(0, entries.length - this.#options.maxCompletedSegments),
    );
    for (const name of remove) {
      await unlink(path.join(this.#directory, name));
      await unlink(path.join(this.#directory, `${name}.manifest.json`)).catch(
        () => undefined,
      );
    }
  }
}
