import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

export const CHART_DIRECTORY = ".runtime/analysis-charts";
const MAX_BYTES = 1_048_576;

function valid(bytes: Buffer, digest: string): boolean {
  return (
    /^[0-9a-f]{64}$/.test(digest) &&
    bytes.length >= 33 &&
    bytes.length <= MAX_BYTES &&
    bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
    bytes.readUInt32BE(16) === 1600 &&
    bytes.readUInt32BE(20) === 1200 &&
    createHash("sha256").update(bytes).digest("hex") === digest
  );
}

export async function readChart(
  digest: string,
  directory = CHART_DIRECTORY,
): Promise<Buffer> {
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("CHART_DIGEST_INVALID");
  if (!(await lstat(directory)).isDirectory())
    throw new Error("CHART_DIRECTORY_INVALID");
  const file = await open(
    path.join(directory, `${digest}.png`),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error("CHART_STORAGE_INVALID");
    const bytes = await file.readFile();
    if (!valid(bytes, digest)) throw new Error("CHART_INTEGRITY_INVALID");
    return bytes;
  } finally {
    await file.close();
  }
}

/** Commit bytes durably before any database reference; existing content must verify. */
export async function writeChart(
  bytes: Buffer,
  digest: string,
  directory = CHART_DIRECTORY,
): Promise<void> {
  if (!valid(bytes, digest)) throw new Error("CHART_INTEGRITY_INVALID");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory())
    throw new Error("CHART_DIRECTORY_INVALID");
  const target = path.join(directory, `${digest}.png`);
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    try {
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await readChart(digest, directory);
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await unlink(temporary);
  }
}
