# ISSUE-384 — Native profit exits after quote-to-fill audit

Issue: https://github.com/AegisFintech/scalping-bot/issues/384.

## Problem and observed scope

The old optional local market-close path could issue a close on modeled net profit
then realize a fee-inclusive loss. The bounded read-only audit includes ALL six
v1 profit-close claims from2026-10-26T00:00:00Z through2026-10-27T03:10:00Z.
Four exact acknowledged closing-order/deal and full-volume matches realized
-64.27 total: +21.77, -21.96, -14.92, -49.16. Two unmatched/native-race claims
remain UNATTRIBUTED_OR_INCOMPLETE, including their positive final outcomes; they
are not credited to this exit path. This is a descriptive operational audit,
not #253 paired replay, a counterfactual backtest, or #255 qualification.
[Immutable scoped snapshot](evidence/native-profit-exit-audit.json).

The four matched moves from trigger executable quote to actual aggregate fill
were adverse0.08/0.22/0.19/0.31 price units; source quote to broker close660–854ms.
The old allowance was0.05. Fees were approximately0.24 price units per position
size. The previous claim of "early exit worked" overstated success: dispatch
occurred but three closes did not preserve net profit. The net accounting
includes signed fees once. No exact SL/TP cause is inferred from P/L.

Observed pip/tick is0.01. Fee0.241 + observed adverse0.31 + intended net0.05,
rounded upward, is0.61 (61 points), above native TP0.40 (40 points). This is an
EX-POST sample calculation, not a recommended live threshold, reliable tail
estimate or claim that those losses would have become wins. Four fills cannot
calibrate a safe market-exit buffer. Higher lots scale fees and adverse movement
as well as profit; they do not correct this mismatch.

## Implemented behavior

New source0.7.3-quick-oco.1-codex.1/policy0.7.3-quick-oco.1 removes the optional
profit quote callback, repeated reconciliation/quote/claim/market-close sequence
from production protection maintenance. A protected position remains VERIFIED;
sampled gross/model-green P/L is not market-close authority. Profit exits use the
existing broker-held0.40 TP. This removes the application's2-second sampled
profit polling and extra reconciliation/claim/close round trips from profit
execution, rather than promising to make a market close instantaneous. It does
not change the independent2-second protection maintenance cadence.

Native SL7.00, OCO STOP_LIMIT/GTC directions, prompt entry guidance, dynamic
shared5% demo sizing, affordability, ownership, session/data/account/reconciliation
and cooldown gates remain. No risk/lot/SL increase and no target widened to0.61.
All accepted groups retain exact native intent/protection. No old order is
cancelled or repriced to accelerate deployment. Old submitted/unknown close
claims still wait for terminal broker evidence and are never replayed. Existing
missing-SL emergency close authority is independent and retained. Manual closes,
partial volumes and external-cancel reconciliation retain existing journal logic.

The old pure v1 evaluator and durable SQL method remain explicitly pinned to
source0.7.2 for historical regression evidence; neither is called by current
production maintenance. The SQL path rejects new-source claims. New provider
promptv4 removes the old early-profit instruction, request1.10 binds exactly
that prompt; response1.2 stays unchanged. Local execution promptv4 and risk
schema1.9 are additive. Old prompt/schema bytes stay unchanged. Provider context
is still historical memory, not training or execution authority.

Status reports `profitExit.mode=BROKER_NATIVE`, `guaranteedNet=false`. During
position management the dashboard explains broker-held TP/SL and that final net
requires broker fills and fees. This mode is distinct from broker-confirmed
protection state; an intent or status label never proves protection/fill.

## Cost and execution limitations

The existing native TP admission still checks minimum AND actual volume against
current broker commission/conversion plus declared5-tick modeled native exit
allowance. That allowance is NOT validated by the four LOCAL market closes, and
is not described as a tail bound. Native TP0.40 leaves about0.16 before exit
movement at observed fees0.24. A broker-native close can still slip enough to
lose net. Broker-held TP removes avoidable client delay; it does not guarantee
positive proceeds, a full fill, stop risk, accuracy or overall profitability.
Live real-money execution remains disabled. No economic promotion follows tests.

## Reproducible review and regression coverage

`node --import tsx scripts/review-profit-exits.ts RELEASE FROM UNTIL` uses explicit
supported release/time bounds (maximum31days), hashed scoped demo account/symbol,
REPEATABLE READ READ ONLY and bounded queries. It emits no account/order/deal IDs,
secrets or raw broker payload. ALL claims in the interval remain in the report;
exact acknowledged close-order matching and full volume are required for timing
and adverse-move attribution. Unmatched/native races, open and partial outcomes
remain explicit/null. Unknown counterfactual net remains null. No promotion,
provider, order or control authority. The v1 net floor0.05 is explicitly pinned
for unit conversion; future economic versions need their own audited contract.

Tests reproduce each of the three real losing trigger prices and verify no
market dispatch/claim or protection amendment occurs for a protected position,
including repeated maintenance. Existing unknown claims are not resent; manual,
missing protection, repair exhaustion, broker failures and idempotency retain
existing negative-path suites. Pure report tests reproduce-14.92,0.19 adverse,
854ms, unmatched/partial/open censoring, invalid time/decimal and bounded scope.
Actual Node-to-Python provider schema validates1.10/5% and rejects old mixed
prompt/request versions. Historical request1.9/schema/risk1.8 stay incompatible
with the new identity. Dashboard tests expose native authority without a profit
promise. No replay result or later price path is used to claim a missed winner.

## Delivery, activation and rollback

Full qualification results and commands are recorded in
[evidence/native-profit-exit-validation.json](evidence/native-profit-exit-validation.json).
Dedicated issue branch/PR, exact-head hosted qualification and main merge precede
activation of ONE matching application/worker/SELECT-only recorder. Keep private
env, worker512MiB cap, broker/account/provider history and immutable studies.
Register a new future observation window with frozen code before outcomes;
30 calendar days is collection only. Verify ready/reconciled source, native
intent geometry, controls, no repeated claims, fresh recorder/dashboard and
normal gated operation. Pending orders never establish an actual fill.

Rollback requires an explicitly reviewed policy release; silently restoring the
known five-tick local market-close path is not authorized by this fix. A normal
maintenance admission hold may precede artifact rollback while accepted GTC/
SL/TP and missing-SL recovery remain active. Preserve every claim/history row;
never reset accounting, replay unknown commands, or edit frozen registrations.

## Qualified source checkpoint

Final exact-source Node22 `node scripts/qualify.mjs` passed every required gate:
1,125 Node +124 isolated PostgreSQL +461 Python tests,1,710 total. Formatting,
lint, types, build, schemas/migrations/replay/fail-closed/lifecycle tests, secret
scan and both dependency audits passed. Both populated policy/startup checks
passed without changing the env. AST Graphify refreshed without API calls. Initial
status typing/text formatting and audit-envelope validation findings were corrected;
intermediate/superseded receipts do not qualify delivery. No native exit tail bound,
profitability, live-money authorization or economic promotion follows these tests.
Detailed exact commands/source fingerprint: [validation](evidence/native-profit-exit-validation.json).
Matching reviewed main activation and operational verification receipt follow on #384.
