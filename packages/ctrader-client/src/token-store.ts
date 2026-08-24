import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { TokenSet } from "./token-manager.js";

export class SecureTokenFileStore {
  readonly #path: string;

  constructor(filePath: string) {
    if (!filePath) throw new Error("CTRADER_TOKEN_STORE_PATH_REQUIRED");
    this.#path = filePath;
  }

  async read(): Promise<TokenSet | null> {
    try {
      const stat = await lstat(this.#path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0
      ) {
        throw new Error("CTRADER_TOKEN_STORE_PERMISSIONS_INVALID");
      }
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as Record<
        string,
        unknown
      >;
      if (
        typeof parsed.access_token !== "string" ||
        typeof parsed.refresh_token !== "string" ||
        typeof parsed.expires_at !== "string"
      ) {
        throw new Error("CTRADER_TOKEN_STORE_INVALID");
      }
      const expiresAt = new Date(parsed.expires_at);
      if (Number.isNaN(expiresAt.getTime()))
        throw new Error("CTRADER_TOKEN_STORE_EXPIRY_INVALID");
      return {
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token,
        expiresAt,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(tokens: TokenSet): Promise<void> {
    const directory = path.dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt.toISOString(),
      }),
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    await rename(temporary, this.#path);
  }

  async coordinateRefresh(
    refreshToken: string,
    refresh: (refreshToken: string) => Promise<TokenSet>,
  ): Promise<TokenSet> {
    await mkdir(path.dirname(this.#path), { recursive: true, mode: 0o700 });
    const lockPath = `${this.#path}.refresh.lock`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          const latest = await this.read();
          if (
            latest !== null &&
            latest.expiresAt.getTime() - Date.now() > 300_000
          )
            return latest;
          return await refresh(latest?.refreshToken ?? refreshToken);
        } finally {
          await handle.close();
          await unlink(lockPath).catch(() => undefined);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const latest = await this.read();
        if (
          latest !== null &&
          latest.expiresAt.getTime() - Date.now() > 300_000
        )
          return latest;
        try {
          const stat = await lstat(lockPath);
          if (Date.now() - stat.mtimeMs > 30_000) await unlink(lockPath);
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== "ENOENT")
            throw statError;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error("CTRADER_TOKEN_REFRESH_LOCK_TIMEOUT");
  }
}
