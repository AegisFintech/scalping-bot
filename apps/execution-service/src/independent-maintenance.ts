/** Serializes protective work independently from potentially slow inference. */
export class IndependentMaintenance {
  #pending: Promise<void> | null = null;
  constructor(private readonly work: () => Promise<void>) {}
  run(): Promise<void> {
    if (this.#pending !== null) return this.#pending;
    this.#pending = this.work().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }
  async settled(): Promise<void> {
    await this.#pending;
  }
}
