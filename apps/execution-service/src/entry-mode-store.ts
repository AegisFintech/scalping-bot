import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  isEntryMode,
  type EntryMode,
  type EntryModeSelection,
} from "../../../packages/contracts/src/entry-mode.js";
export class EntryModeStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly scope: {
      accountId: string;
      symbolId: string;
      mode: string;
    },
  ) {}
  async initialize(): Promise<void> {
    if (this.scope.mode !== "demo") throw new Error("ENTRY_MODES_DEMO_ONLY");
    await this.pool.query(
      `INSERT INTO entry_mode_settings(account_id,symbol_id,environment,entry_mode,revision,actor,reason) VALUES($1,$2,$3,'OCO_STOP_LIMIT',$4,'operator-release','Operator authorized fixed dual breakout STOP_LIMIT OCO') ON CONFLICT(account_id,symbol_id,environment) DO NOTHING`,
      [
        this.scope.accountId,
        this.scope.symbolId,
        this.scope.mode,
        randomUUID(),
      ],
    );
  }
  async read(): Promise<EntryModeSelection> {
    const r = await this.pool.query<{ entry_mode: string; revision: string }>(
      `SELECT entry_mode,revision FROM entry_mode_settings WHERE account_id=$1 AND symbol_id=$2 AND environment=$3`,
      [this.scope.accountId, this.scope.symbolId, this.scope.mode],
    );
    const row = r.rows[0];
    if (r.rowCount !== 1 || !row || !isEntryMode(row.entry_mode))
      throw new Error("ENTRY_MODE_UNAVAILABLE");
    return { mode: row.entry_mode, revision: row.revision };
  }
  /** New admission only. Historical groups retain their recorded mode. */
  async readForAdmission(): Promise<EntryModeSelection> {
    const selection = await this.read();
    if (selection.mode !== "OCO_STOP_LIMIT")
      throw new Error("FIXED_OCO_STOP_LIMIT_MODE_REQUIRED");
    return selection;
  }
  async select(input: {
    mode: EntryMode;
    expectedRevision: string;
    actor: string;
    reason: string;
  }): Promise<EntryModeSelection> {
    if (!isEntryMode(input.mode) || !input.actor || !input.reason)
      throw new Error("ENTRY_MODE_INVALID");
    const revision = randomUUID();
    const r = await this.pool.query(
      `UPDATE entry_mode_settings SET entry_mode=$4,revision=$5,actor=$6,reason=$7,updated_at=clock_timestamp() WHERE account_id=$1 AND symbol_id=$2 AND environment=$3 AND revision=$8 RETURNING revision`,
      [
        this.scope.accountId,
        this.scope.symbolId,
        this.scope.mode,
        input.mode,
        revision,
        input.actor,
        input.reason,
        input.expectedRevision,
      ],
    );
    if (r.rowCount !== 1) throw new Error("ENTRY_MODE_CHANGED_REFRESH");
    return { mode: input.mode, revision };
  }
}
