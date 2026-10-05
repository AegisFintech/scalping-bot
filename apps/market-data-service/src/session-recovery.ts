/** Used only by the market-data client, which has no order authority. */
export class SessionRecovery {
  private pending: Promise<void> | null = null;
  private failures = 0;
  private nextReconnectAt = 0;
  private reconnects = 0;
  constructor(
    private readonly options: {
      probe: () => Promise<unknown>;
      reconnect: () => Promise<void>;
      observe: (event: string, failures: number) => void;
      now?: () => number;
    },
  ) {}

  check(): Promise<void> {
    this.pending ??= this.run().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async drain(): Promise<void> {
    await this.pending;
  }

  private async run(): Promise<void> {
    try {
      await this.options.probe();
      if (this.failures > 0)
        this.options.observe("MARKET_SESSION_RECOVERED", this.failures);
      this.failures = 0;
      this.reconnects = 0;
    } catch {
      this.failures++;
      this.options.observe("MARKET_SESSION_PROBE_FAILED", this.failures);
      const now = (this.options.now ?? Date.now)();
      if (this.failures < 3 || now < this.nextReconnectAt) return;
      this.nextReconnectAt =
        now + Math.min(300_000, 60_000 * 2 ** Math.min(this.reconnects++, 3));
      this.options.observe("MARKET_SESSION_RECONNECT", this.failures);
      try {
        await this.options.reconnect();
      } catch {
        this.options.observe("MARKET_SESSION_RECONNECT_FAILED", this.failures);
      }
      // Only a successful later probe proves recovery.
    }
  }
}
