/** Bounded observational tape. Callback never waits for disk or sends broker requests. */
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { FlightQuoteObservation } from "../../../packages/contracts/src/flight-quotes.js";

const compress = promisify(gzip);
const MAX_BYTES = 256 * 1024 * 1024;
const SEGMENT_BYTES = 1024 * 1024;
const FREE_RESERVE = 2 * 1024 * 1024 * 1024;
const FILE = /^idle-[a-f0-9-]+-\d{8}\.jsonl\.gz(?:\.manifest\.json)?$/;
export class IdleQuoteRecorder {
  readonly streamId = randomUUID();
  #queue = Promise.resolve();
  #pending = 0;
  #sequence = 0;
  #segment = 0;
  #rows: string[] = [];
  #bytes = 0;
  #bidSource: string | null = null;
  #askSource: string | null = null;
  #bidReceived: string | null = null;
  #askReceived: string | null = null;
  #persisted = 0;
  #failed = false;
  #lastAt: number | null = null;
  #written = 0;
  #dropped = 0;
  #error: string | null = null;
  #stopped = false;
  constructor(
    readonly directory: string,
    readonly symbol: string,
    readonly source: string,
  ) {
    if (
      !/^[A-Z0-9._-]{1,32}$/.test(symbol) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(source) ||
      path.resolve(directory) === path.parse(path.resolve(directory)).root
    )
      throw new Error("IDLE_TAPE_CONFIG_INVALID");
  }
  get status() {
    return {
      schemaVersion: "idle-quote-status-1.0",
      streamId: this.streamId,
      source: this.source,
      observedUpdates: this.#written,
      persistedUpdates: this.#persisted,
      droppedUpdates: this.#dropped,
      pendingUpdates: this.#pending,
      lastError: this.#error,
      stopped: this.#stopped,
      completeTickTape: false,
    };
  }
  observe(event: FlightQuoteObservation): void {
    if (event.kind !== "RECONNECT" && event.symbolName !== this.symbol) return;
    const sequence = ++this.#sequence;
    if (this.#stopped || this.#failed || this.#pending >= 2048) {
      this.#dropped++;
      this.#error ??= "IDLE_TAPE_QUEUE_OR_STOPPED";
      return;
    }
    // Copy now: adapters may reuse their objects after returning from the callback.
    const value = { ...event };
    this.#pending++;
    this.#queue = this.#queue
      .then(async () => {
        if (this.#failed) {
          this.#dropped++;
          return;
        }
        const at = Date.parse(value.receivedAt);
        if (
          !Number.isFinite(at) ||
          (this.#lastAt !== null && at < this.#lastAt)
        )
          throw new Error("IDLE_TAPE_RECEIVE_ORDER");
        if (value.kind === "RECONNECT") {
          this.#bidSource = null;
          this.#askSource = null;
          this.#bidReceived = null;
          this.#askReceived = null;
        } else {
          if (value.bidUpdated) {
            this.#bidSource = value.sourceTime;
            this.#bidReceived = value.receivedAt;
          }
          if (value.askUpdated) {
            this.#askSource = value.sourceTime;
            this.#askReceived = value.receivedAt;
          }
        }
        if (
          this.#lastAt !== null &&
          Math.floor(at / 300000) !== Math.floor(this.#lastAt / 300000)
        )
          await this.#seal();
        const row = JSON.stringify({
          schemaVersion: "idle-quote-update-1.0",
          streamId: this.streamId,
          sequence,
          source: this.source,
          ...value,
          bidSourceTime: this.#bidSource,
          askSourceTime: this.#askSource,
          bidReceivedAt: this.#bidReceived,
          askReceivedAt: this.#askReceived,
        });
        this.#rows.push(row);
        this.#bytes += Buffer.byteLength(row) + 1;
        this.#lastAt = at;
        this.#written++;
        if (this.#bytes >= SEGMENT_BYTES) await this.#seal();
      })
      .catch((error: unknown) => {
        this.#dropped++;
        this.#failed = true;
        this.#error =
          error instanceof Error && /^IDLE_TAPE_[A-Z_]+$/.test(error.message)
            ? error.message
            : "IDLE_TAPE_IO_FAILURE";
      })
      .finally(() => {
        this.#pending--;
      });
  }
  async flush(): Promise<void> {
    this.#queue = this.#queue.then(() => this.#seal());
    await this.#queue;
  }
  async stop(): Promise<void> {
    this.#stopped = true;
    await this.flush();
  }
  async #seal(): Promise<void> {
    if (this.#rows.length === 0) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const fs = await statfs(this.directory);
    const names = await readdir(this.directory);
    // No automatic evidence deletion: capacity exhaustion is visible and stops this tape only.
    if (
      names.length > 10000 ||
      fs.bavail * fs.bsize < FREE_RESERVE + 2 * SEGMENT_BYTES
    ) {
      this.#failed = true;
      this.#error = "IDLE_TAPE_CAPACITY";
      throw new Error(this.#error);
    }
    let used = 0;
    for (const name of names)
      if (FILE.test(name))
        used += (await stat(path.join(this.directory, name))).size;
    const raw = Buffer.from(this.#rows.join("\n") + "\n");
    const compressed = await compress(raw, { level: 6 });
    if (used + compressed.length + 4096 > MAX_BYTES) {
      this.#failed = true;
      this.#error = "IDLE_TAPE_CAPACITY";
      throw new Error(this.#error);
    }
    const file = `idle-${this.streamId}-${String(++this.#segment).padStart(8, "0")}.jsonl.gz`;
    const destination = path.join(this.directory, file);
    await writeFile(destination + ".tmp", compressed, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(destination + ".tmp", destination);
    // Verify bytes before publishing a manifest. Files without manifests are incomplete evidence.
    if (!compressed.equals(await readFile(destination)))
      throw new Error("IDLE_TAPE_WRITE_VERIFY");
    const first = JSON.parse(this.#rows[0]!) as {
      sequence: number;
      receivedAt: string;
    };
    const last = JSON.parse(this.#rows.at(-1)!) as {
      sequence: number;
      receivedAt: string;
    };
    const manifest = {
      schemaVersion: "idle-quote-manifest-1.0",
      file,
      streamId: this.streamId,
      source: this.source,
      sourceProvenance: "PROCESS_CODE_VERSION_NOT_INDEPENDENTLY_VERIFIED",
      symbol: this.symbol,
      sha256: createHash("sha256").update(compressed).digest("hex"),
      uncompressedSha256: createHash("sha256").update(raw).digest("hex"),
      compressedBytes: compressed.length,
      updates: this.#rows.length,
      firstSequence: first.sequence,
      lastSequence: last.sequence,
      firstReceivedAt: first.receivedAt,
      lastReceivedAt: last.receivedAt,
      droppedUpdates: this.#dropped,
      lastError: this.#error,
      continuousTickTape: false,
      remoteArchiveVerified: false,
      automaticEviction: false,
    };
    await writeFile(
      destination + ".manifest.json.tmp",
      JSON.stringify(manifest) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await rename(
      destination + ".manifest.json.tmp",
      destination + ".manifest.json",
    );
    this.#persisted += this.#rows.length;
    this.#rows = [];
    this.#bytes = 0;
  }
}
