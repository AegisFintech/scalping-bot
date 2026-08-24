import { createHash, randomUUID } from "node:crypto";

import type pg from "pg";

import type { SymbolMetadata } from "../../contracts/src/index.js";

export interface RuntimeIdentity {
  readonly accountId: string;
  readonly symbolId: string;
  readonly strategyVersionId: string;
}

export async function ensureRuntimeIdentity(
  pool: pg.Pool,
  input: {
    readonly accountKey: string;
    readonly provider: "paper" | "ctrader";
    readonly environment: "paper" | "demo" | "live";
    readonly accountType: "paper" | "demo" | "live";
    readonly currency: string;
    readonly metadata: SymbolMetadata;
    readonly strategyVersion: string;
    readonly codeHash: string;
    readonly configHash: string;
    readonly promptVersion: string;
    readonly schemaVersion: string;
    readonly featureVersion: string;
  },
): Promise<RuntimeIdentity> {
  if (input.accountKey === "unconfigured" || input.accountKey.length < 8) {
    throw new Error("ACCOUNT_KEY_PSEUDONYM_REQUIRED");
  }
  if (!/^[A-Z]{3,8}$/.test(input.currency))
    throw new Error("ACCOUNT_CURRENCY_INVALID");
  const accountHash = createHash("sha256")
    .update(input.accountKey)
    .digest("hex");
  const metadataRevision = createHash("sha256")
    .update(JSON.stringify(input.metadata))
    .digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query<{ id: string }>(
      `INSERT INTO accounts
        (id, provider, provider_account_key_hash, environment, account_type, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider, provider_account_key_hash, environment)
       DO UPDATE SET currency = EXCLUDED.currency, active = true, updated_at = now()
       RETURNING id`,
      [
        randomUUID(),
        input.provider,
        accountHash,
        input.environment,
        input.accountType,
        input.currency,
      ],
    );
    const accountId = account.rows[0]?.id;
    if (accountId === undefined) throw new Error("ACCOUNT_REGISTRY_FAILED");
    const symbol = await client.query<{ id: string }>(
      `INSERT INTO symbols
        (id, account_id, provider_symbol_id, name, digits, tick_size, tick_value, contract_size,
         volume_scale, min_volume, max_volume, volume_step, min_stop_distance,
         metadata_revision, metadata_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (account_id, provider_symbol_id)
       DO UPDATE SET name = EXCLUDED.name, digits = EXCLUDED.digits, tick_size = EXCLUDED.tick_size,
         tick_value = EXCLUDED.tick_value, contract_size = EXCLUDED.contract_size,
         volume_scale = EXCLUDED.volume_scale, min_volume = EXCLUDED.min_volume,
         max_volume = EXCLUDED.max_volume, volume_step = EXCLUDED.volume_step,
         min_stop_distance = EXCLUDED.min_stop_distance,
         metadata_revision = EXCLUDED.metadata_revision, metadata_at = EXCLUDED.metadata_at,
         updated_at = now()
       RETURNING id`,
      [
        randomUUID(),
        accountId,
        input.metadata.symbolId,
        input.metadata.symbolName,
        input.metadata.digits,
        input.metadata.tickSize,
        input.metadata.tickValue,
        input.metadata.contractSize,
        input.metadata.volumeScale,
        input.metadata.minVolume,
        input.metadata.maxVolume,
        input.metadata.volumeStep,
        input.metadata.minStopDistance,
        metadataRevision,
        input.metadata.metadataTime,
      ],
    );
    const symbolId = symbol.rows[0]?.id;
    if (symbolId === undefined) throw new Error("SYMBOL_REGISTRY_FAILED");
    const strategy = await client.query<{
      id: string;
      code_hash: string;
      config_hash: string;
      prompt_version: string;
      schema_version: string;
      feature_version: string;
    }>(
      `INSERT INTO strategy_versions
        (id, version, code_hash, config_hash, prompt_version, schema_version, feature_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (version) DO UPDATE SET version = EXCLUDED.version
       RETURNING id, code_hash, config_hash, prompt_version, schema_version, feature_version`,
      [
        randomUUID(),
        input.strategyVersion,
        input.codeHash,
        input.configHash,
        input.promptVersion,
        input.schemaVersion,
        input.featureVersion,
      ],
    );
    const strategyRow = strategy.rows[0];
    if (strategyRow === undefined) throw new Error("STRATEGY_REGISTRY_FAILED");
    if (
      strategyRow.code_hash !== input.codeHash ||
      strategyRow.config_hash !== input.configHash ||
      strategyRow.prompt_version !== input.promptVersion ||
      strategyRow.schema_version !== input.schemaVersion ||
      strategyRow.feature_version !== input.featureVersion
    ) {
      throw new Error("STRATEGY_VERSION_IMMUTABILITY_VIOLATION");
    }
    await client.query("COMMIT");
    return { accountId, symbolId, strategyVersionId: strategyRow.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
