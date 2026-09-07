# ISSUE-072: populated environment migration

Date: 2026-09-07. Issue: [#174](https://github.com/AegisFintech/scalping-bot/issues/174).
Branch: `issue-072-local-environment-simplification`; baseline: merged ISSUE-069
commit `ac3cbae`. The operator explicitly authorized simplifying the actual local
environment while preserving credentials, capital limits and trading controls.

## Implemented result

| Item                                     | Before                            | After                                       |
| ---------------------------------------- | --------------------------------- | ------------------------------------------- |
| Populated `.env` assignments             | 176                               | 26: 150 removed, 85.2% reduction            |
| Normal `.env.sample` assignments         | 176 original / 25 after ISSUE-069 | 22: 87.5% below original                    |
| Explicit `AI_MODEL`                      | `gpt-5.6-sol/u40`                 | `gpt-6-astra/u64`                           |
| Credentials and provider endpoint        | Existing private values           | Unchanged                                   |
| Capital bounds and trading authorization | Existing values                   | Unchanged, including the blank equity floor |
| File and backup permissions              | `.env` mode 0600                  | Both mode 0600; backup directory mode 0700  |

The four additional local entries are `GH_USER`, `GH_REPO`, `GH_PAT` and the
existing `BETTERSTACK_HEARTBEAT_URL`. They preserve deployment identity and
credentials, including the unused heartbeat credential. They are not tuning
settings and their values are not in this report or Git. No populated secret was
discarded. All 25 retained values other than the model pin compare equal to the
original file.

The migration parsed and checked every assignment, rejected duplicate or
multiline ambiguity, compared redundant endpoints/ports/paths with code defaults,
and preserved the original file in an ignored protected backup before an atomic
write. The local backup is under
`.runtime/config-backups/2026-09-07T02-04-42-118Z/.env`. A second read verified the
result and permissions. The populated environment and backup remain ignored.

Indicator, scheduling, model-tuning, volume, risk-percentage and execution
internals come from the existing `conservative-v1` policy. Risk percentages,
daily-loss/margin ceilings and the absolute spread ceiling match the old file;
the fixed daily order limit remains the reviewed 100, below the old file's 103.
No strategy or risk policy was changed in this follow-up. Custom deployment
overrides remain supported; the normal template omits redundant cTrader host,
port, connection environment and blank token-expiry fields. The exact model pin
is visible and still rejects a different nonempty model.

## Validation and provider observation

`config:check` now reports actual file and normal template counts separately,
the exact resolved model, and the check's scope. Its new `--startup` option also
runs the execution configuration parser without starting services or contacting
the broker. Tests cover stopped template defaults, secret redaction, file
immutability, actual counts, old-model rejection, unknown arguments and the
missing demo capital floor.

- `npm run config:check -- .env`: passed; 26 file entries / 22 normal entries;
  resolved model `gpt-6-astra/u64`.
- `npm run config:check -- .env --startup`: expected rejection
  `CONFIG_DEMO_EQUITY_FLOOR_REQUIRED`. This is a real deployment blocker, not a
  successful startup check.
- A single bounded Responses request using the preserved credentials and exact
  model returned HTTP 200, valid strict boolean JSON, and returned model
  `gpt-6-astra`. Latency: 10,215 ms; input/output/total tokens: 4,417 / 13 / 4,430.
  This is the previously observed provider normalization, not a fallback. It
  tests basic routing/schema access only; it does not establish trading-payload
  reliability, model quality, pricing or profitability. Cost remains unavailable.
- Full repository gates passed on Node 22.23.2 / Python 3.13.5: 335 Node tests
  across 53 files, 107 Python tests, 19 schema tests, 3 static migration tests and
  all 3 configured isolated-database integration tests. Both dependency audits
  found no known vulnerabilities. Replay/backtest fixtures completed as software
  checks only. No economic-performance claim follows from these checks.

## Running services and remaining rollout requirements

All five existing PM2 services were online during the audit and retained their
original PIDs. Execution/dashboard PM2 environments explicitly retain the old
model. All five contain conflicting old reasoning-effort and release-identity
overrides; execution/dashboard also contain old AI schema, timeout, temperature,
order-count and broker-discovery overrides. These were inspected with values
redacted. Editing `.env` does not change an already-running process.

No service was restarted, no PM2 cache was modified, no production migration was
applied, and no trading was launched or enabled by this task. The current build's
live gateway remains disabled. The previous running demo services are not
claimed to be using the new model or source release.

The existing `ACCOUNT_EQUITY_FLOOR` is blank in both `.env` and PM2. An explicit
positive account-currency floor is required for enabled demo startup; the task
does not invent or infer that capital authorization. A coordinated rollout also
needs the protected database backup, additive migration `0015`, paused/reconciled
account state, recreation of named services to remove cached overrides, and
verification before any separately authorized demo resumption. Follow
[configuration.md](configuration.md). Restarting only AI would mix prompt/release
contracts with the old execution process and is not the rollout procedure.

## Rollback

Retain the protected original environment with the previous release. Restore it
only with that compatible release and a paused/reconciled rollout. Restoring the
176-setting file while starting the new build correctly causes policy conflicts.
Never commit either populated environment, reset financial state or infer trading
authorization from rollback. Existing broker protections remain under the running
service's management during this configuration-only task.

## Exact completion commands

All commands below exited 0. The configured integration command passes the existing
connection through the child environment; its value is never printed. Raw logs
are ignored under `artifacts/config-simplification/gates/`.

| Command                                                                                                                                                                                                                                                                      | Result               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `node --version`                                                                                                                                                                                                                                                             | Passed               |
| `npm run format:check`                                                                                                                                                                                                                                                       | Passed               |
| `npm run lint`                                                                                                                                                                                                                                                               | Passed               |
| `npm run typecheck`                                                                                                                                                                                                                                                          | Passed               |
| `npm run build`                                                                                                                                                                                                                                                              | Passed               |
| `npm test`                                                                                                                                                                                                                                                                   | Passed               |
| `npm run test:schemas`                                                                                                                                                                                                                                                       | Passed               |
| `npm run test:migrations`                                                                                                                                                                                                                                                    | Passed               |
| `node --input-type=module -e "import 'dotenv/config'; import {spawnSync} from 'node:child_process'; const r=spawnSync('npm',['run','test:integration'],{env:{...process.env,TEST_DATABASE_URL:process.env.DATABASE_URL},stdio:'inherit'}); process.exitCode=r.status ?? 1;"` | Passed               |
| `.venv/bin/ruff format --check python apps/dashboard tests/python`                                                                                                                                                                                                           | Passed               |
| `.venv/bin/ruff check python apps/dashboard tests/python`                                                                                                                                                                                                                    | Passed               |
| `.venv/bin/mypy python apps/dashboard`                                                                                                                                                                                                                                       | Passed               |
| `.venv/bin/pytest -q`                                                                                                                                                                                                                                                        | Passed               |
| `npm run config:check -- .env.sample --startup`                                                                                                                                                                                                                              | Passed               |
| `npm run config:check -- .env`                                                                                                                                                                                                                                               | Passed               |
| `bash scripts/secret-scan.sh`                                                                                                                                                                                                                                                | Passed               |
| `npm audit --audit-level=high`                                                                                                                                                                                                                                               | Passed               |
| `.venv/bin/pip-audit -r requirements.lock`                                                                                                                                                                                                                                   | Passed               |
| `.venv/bin/python -m python.replay.cli --input tests/fixtures/replay/analytics-requests.jsonl`                                                                                                                                                                               | Passed; fixture only |
| `.venv/bin/python -m python.backtest.cli --input tests/fixtures/backtest/oco-scenario.json --output artifacts/config-simplification/backtest-smoke.json`                                                                                                                     | Passed; fixture only |
