import { record, stringField } from "./protocol.js";

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

export interface TokenManagerOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenUrl: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt?: Date;
  readonly refreshSkewMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onRefresh?: (tokens: TokenSet) => Promise<void> | void;
  readonly refreshCoordinator?: (
    refreshToken: string,
    refresh: (refreshToken: string) => Promise<TokenSet>,
  ) => Promise<TokenSet>;
}

export class CTraderTokenManager {
  readonly #options: TokenManagerOptions;
  #tokens: TokenSet | null;
  #refreshing: Promise<TokenSet> | null = null;

  constructor(options: TokenManagerOptions) {
    this.#options = options;
    this.#tokens =
      options.accessToken && options.accessTokenExpiresAt !== undefined
        ? {
            accessToken: options.accessToken,
            refreshToken: options.refreshToken,
            expiresAt: options.accessTokenExpiresAt,
          }
        : null;
  }

  get expiryKnown(): boolean {
    return this.#tokens !== null;
  }

  async accessToken(now = new Date()): Promise<string> {
    const skew = this.#options.refreshSkewMs ?? 300_000;
    if (
      this.#tokens !== null &&
      this.#tokens.expiresAt.getTime() - now.getTime() > skew
    ) {
      return this.#tokens.accessToken;
    }
    if (this.#options.refreshToken) return (await this.refresh()).accessToken;
    if (this.#options.accessToken) return this.#options.accessToken;
    throw new Error("CTRADER_ACCESS_TOKEN_REQUIRED");
  }

  async refresh(): Promise<TokenSet> {
    if (this.#refreshing !== null) return this.#refreshing;
    const refreshToken =
      this.#tokens?.refreshToken || this.#options.refreshToken;
    if (!refreshToken) throw new Error("CTRADER_REFRESH_TOKEN_REQUIRED");
    this.#refreshing =
      this.#options.refreshCoordinator === undefined
        ? this.#refreshToken(refreshToken)
        : this.#options.refreshCoordinator(refreshToken, (coordinatedToken) =>
            this.#refreshToken(coordinatedToken),
          );
    try {
      const tokens = await this.#refreshing;
      this.#tokens = tokens;
      return tokens;
    } finally {
      this.#refreshing = null;
    }
  }

  async #refreshToken(refreshToken: string): Promise<TokenSet> {
    const url = new URL(
      this.#options.tokenUrl || "https://openapi.ctrader.com/apps/token",
    );
    url.search = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.#options.clientId,
      client_secret: this.#options.clientSecret,
    }).toString();
    const response = await (this.#options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`CTRADER_TOKEN_REFRESH_FAILED:${response.status}`);
    const payload = record(
      await response.json(),
      "CTRADER_TOKEN_RESPONSE_INVALID",
    );
    const expiresIn = Number(stringField(payload, "expiresIn"));
    if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0)
      throw new Error("CTRADER_TOKEN_EXPIRY_INVALID");
    const tokens: TokenSet = {
      accessToken: stringField(payload, "accessToken"),
      refreshToken: stringField(payload, "refreshToken"),
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
    this.#tokens = tokens;
    await this.#options.onRefresh?.(tokens);
    return tokens;
  }
}
