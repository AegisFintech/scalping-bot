import type { EntryModeSelection } from "../../../packages/contracts/src/entry-mode.js";
import { entryModeProfile } from "../../../packages/contracts/src/entry-mode.js";
import type { CycleResult, ModelProvider } from "./coordinator.js";
/** One runner lock across all four profiles; no second scheduler or gateway. */
export class EntryModeCoordinator {
  #running = false;
  #selection: EntryModeSelection | null = null;
  get runningSelection() {
    return this.#selection;
  }
  constructor(
    private readonly store: { read(): Promise<EntryModeSelection> },
    private readonly create: (selection: EntryModeSelection) => {
      runOnce(): Promise<CycleResult>;
    },
  ) {}
  async runOnce(): Promise<CycleResult> {
    if (this.#running) throw new Error("ANALYSIS_CYCLE_ALREADY_RUNNING");
    this.#running = true;
    try {
      this.#selection = await this.store.read();
      return await this.create(this.#selection).runOnce();
    } finally {
      this.#running = false;
      this.#selection = null;
    }
  }
}
export function entryModeModel(
  model: ModelProvider,
  selection: EntryModeSelection,
): ModelProvider {
  const profile = entryModeProfile(selection.mode);
  return {
    get circuitOpen() {
      return model.circuitOpen;
    },
    ...(model.prepare
      ? {
          prepare: (
            input: Parameters<NonNullable<ModelProvider["prepare"]>>[0],
          ) => model.prepare!(input),
        }
      : {}),
    // Mode-neutral ranges retain their original prices. Crossed entries wait for
    // ordinary expiry/refresh; never retire them with historical STOP-only evidence.
    async analyze(request) {
      const result = await model.analyze(request);
      const { entrySide, ...base } = result;
      if (entrySide !== "BUY" && entrySide !== "SELL")
        throw new Error("ENTRY_MODE_MODEL_SIDE_REQUIRED");
      const response = structuredClone(result.response);
      if (profile.limit) {
        const buy = response.buy_stop,
          sell = response.sell_stop;
        Object.assign(response, { buy_stop: sell, sell_stop: buy });
        Object.assign(response.technical_map.bullish_confirmation, {
          price: response.buy_stop.entry_price,
        });
        Object.assign(response.technical_map.bearish_confirmation, {
          price: response.sell_stop.entry_price,
        });
      }
      Object.assign(response, {
        setup_tags: [...response.setup_tags, `OPERATOR_${selection.mode}`],
      });
      const selected = profile.limit
        ? entrySide === "BUY"
          ? "SELL"
          : "BUY"
        : entrySide;
      return {
        ...base,
        response,
        ...(profile.single ? { entrySide: selected } : {}),
      };
    },
  };
}
