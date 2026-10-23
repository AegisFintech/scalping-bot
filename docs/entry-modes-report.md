# ISSUE-370 — Four entry modes on the existing demo

Operator request: replace the immediate flip with four dashboard choices. This
supersedes the earlier single-direction-only authority for NEW setups only.
One bot, scheduler, broker gateway, account scope and analysis pipeline remain.

| Mode              | Executable entries from the same Codex range                 |
| ----------------- | ------------------------------------------------------------ |
| OCO stop-limit    | BUY upper and SELL lower, cancel the owned peer after a fill |
| OCO limit         | BUY lower and SELL upper, cancel the owned peer after a fill |
| Single stop-limit | Original Codex direction at its original boundary            |
| Single limit      | Opposite Codex direction at the SAME original boundary       |

WAIT creates no order in any mode. Single limit is a genuine same-level fade:
Codex BUY upper becomes SELL LIMIT upper, Codex SELL lower becomes BUY LIMIT lower.
It is not an opposite-edge breakout, market order, quote-adjacent clamp or automatic
profitability inference. A stop-limit can miss a fast fill; limit and stop-limit
strategies have different executable paths and costs. Negated historical P/L is
not a reversal backtest. No martingale, grid, loss chasing or forced frequency.

## Authority and lifecycle

Source `0.6.0-entry-modes.1-codex.1`, policy `0.6.0-entry-modes.1`, provider
`entry-modes-v1`, worker request 1.6 / response 1.2, local range
`entry-modes-1.0`, execution artifact `entry-modes-execution-v1`. Same Codex model,
strict BUY/SELL/WAIT response, fresh completed M1/M5/M15 and technical/DOM/cost
context, existing persistent daily memory and all operational gates. Historical
prompts/schemas/migrations/registrations retain their bytes. The latest prompt
makes the original model trend judgment distinct from the operator's execution
profile; the model cannot select risk or change the profile.

Migration 0033 adds scoped, durable mode settings and append-only revision history.
Initial selection is SINGLE_LIMIT, matching the operator's explicit flip/LIMIT
request; no environment tuning keys. Each evaluation captures one revision, and a
single runner lock serializes all profiles. Late authorization rechecks that
revision. At durable intent a database row lock verifies the current mode/revision,
closing the race with an operator click. A changed revision rejects that old
proposal; subsequent evaluations use the selected mode. Storage failures block
new analysis/placement without guessing a default.

Order groups record immutable execution_mode/mode_revision and actual entry_side
for singles. The trigger binds every command's side, original range price,
STOP_LIMIT/LIMIT type, ownership and GTC to the READY scoped context. Deferred
cardinality requires exactly one selected order or exactly two distinct sides.
The dashboard distinguishes READY, ACTIVE, QUEUED, RESTARTING and UNVERIFIED.
A switch during a working order/trade queues the selected profile until the full
setup is terminal/reconciled. Before durable order intent, a revision change
withholds the old execution proposal and the next scheduled analysis cycle
restarts under the selected profile (not an OS/process restart). A committed
intent or sent/uncertain command is treated as a setup being placed: reconcile
it rather than assuming a click is atomic with broker receipt. Provider calls
already in flight retain their unknown-outcome/cooldown rules.
A mode switch does not relabel, reprice, cancel or close an accepted group, and
active-group exclusion prevents a second setup. Native maintenance/restart and
terminal proof continue using that group's original order cardinality. Old groups
with NULL mode keep their historical two-order or explicitly marked single-order
contract; no missing peer is reinterpreted as a single.

Mode-neutral fresh ranges can be reused across operator selections before intent;
no price moves and each local decision records its actual mode. Unexecutable
selected quotes are withheld at the fresh effective/late semantic gates. New
mode-neutral contexts do not use the historical STOP-only immediate replacement
proof: crossed ranges wait for ordinary fresh-context expiry/admission. Historical
once-only replacement behavior and failure/unknown/provider cooldowns stay intact.
There is no new analysis call or timer cancellation with an accepted active group.

## Risk, protection and controls

Each leg retains at most 0.5% reconciled current equity; an OCO pair shares at most
1% and a single never inherits its absent peer's allocation. Exact costs, broker
margin, volume steps, conservative slippage reserves and late cap checks remain.
The native distance is the same box width plus one tick, inward pip rounded;
SL and equal gross TP are mirrored for LIMIT sides. This changes entry direction
and native order type, not the reward distance or the separately unapproved quick
exit hypotheses. Broker fills and future costs can exceed modeled loss/reward.
Old fade-release ATR/trend admission and quote clamping are not revived.

The four buttons highlight the durable selected mode. Changes use the existing
execution control token, explicitly supplied through the dashboard's Unlock
password dialog and retained only in browser memory. No server credential is
embedded in HTML/JSON, a URL, cookies or browser storage. Same-origin fixed-loopback
proxy, exact enum/revision validation, existing backend authentication and atomic
compare-and-swap protect selection; stale browser clicks reject and refresh.
A mode choice is not a start/stop, cancel, close or safety override. Dashboard
reads and timed polling remain read-only. The decision tape records mode changes;
current orders display their actual native type rather than the next setup mode.

## Qualification and rollout

Tests cover all four mappings/both model sides, unchanged range and protection,
WAIT/schema mismatch, one global runner, no storage fallback, both native LIMIT
sides/restart, shared dynamic sizing without historical trend filters, authenticated
CAS controls and same-origin proxy, additive migration plus immutable group,
price/type/cardinality/history and stale-revision intent rejection. Existing
legacy pair/single fill/repair/terminal permutations remain required.

Frozen `npm run qualify` passed all formatting/lint/type/build, schema/migration/
replay/fail-closed, secret-scan and Node/Python dependency-audit gates: 1074 Node + 115 isolated PostgreSQL + 438 Python tests (1627 total). Both sample
policy/startup configuration checks and JS syntax checks pass. AST-only Graphify
was refreshed; document semantics were not freshly extracted.
[Exact validation fingerprints](evidence/entry-modes-validation.json) bind this
source. Early fixture/schema-title and migration syntax/type failures were fixed
before the frozen successful run. Dedicated PR/exact-head hosted checks, merged
main and matching worker/bot deployment receipts follow in [issue #370](https://github.com/AegisFintech/scalping-bot/issues/370).

Deploy with the same database/runtime and audited additive local-admin migration;
no application schema CREATE/ownership escalation or financial/request reset.
Only scoped SELECT/INSERT/UPDATE on new settings and SELECT/INSERT on its audit
table are needed; the local administrator verifies historical privileges and
retains the no-CREATE boundary. Startup initialization uses the existing bounded
database retry before broker clients are constructed; no supervisor restart storm. Preserve active
accepted orders/native protection and complete reconciliation. Freeze a new future
30-day observation cohort / seven-day bounded read-only sampled-path window before
activation; preserve old registrations. Record every operator mode revision and
attribute outcomes through the recorded group mode, including rejects, nonfills,
open/gap/ambiguous paths and unknown counterfactual costs. Do not select only
winning modes/days or promote automatically. Collection is not qualification.
Rollback keeps migration/history and requires every new mode-authorized group
fully terminal before restoring older application/worker code; no down migration.
