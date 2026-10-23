# ISSUE-372 — Fixed single breakout STOP_LIMIT

The operator approved STOP_LIMIT only, following Codex's original direction rather
than fading it. This supersedes #370's four selectable modes for new setups.
Source `0.6.0-entry-modes.1-codex.2` retains policy `0.6.0-entry-modes.1`, prompt
`entry-modes-v1`, worker request 1.6/response 1.2 and the unchanged strict
BUY/SELL/WAIT response. Codex already receives instructions to choose established
trend continuation and avoid anticipated reversal. BUY uses the original upper
boundary; SELL uses the original lower boundary. WAIT cannot create an order.
No claim is made that the model identifies a trend correctly or produces profit.

## Scope and lifecycle

Removed four mode buttons, Unlock/token dialog, browser credential/mutation code,
unused control CSS, dashboard POST proxy and backend mode-selection route. The
browser polls read-only evidence; old authenticated mutation callers receive 404.
The desk continues to show actual native order types and historical events.

Fresh scopes initialize SINGLE_STOP_LIMIT without overwriting existing settings.
Initial and late admission explicitly reject any persisted alternative rather than
silently using it or guessing a default on storage failure. Durable revision and
transactional intent checks remain. Historical mode types, store CAS, geometry,
SQL and recovery paths remain to recover/audit old accepted groups and qualify
legacy cardinality; there is no public selection control. A privileged database
administrator is not constrained by removing dashboard controls.

Before route removal, the authorized existing demo selection was changed through
the authenticated revision-CAS API to SINGLE_STOP_LIMIT. Accepted orders and
positions retain original mode, prices, volume and native protection; selection
never cancels, reverses or closes them. Active-group exclusion, GTC, broker/session,
data/account reconciliation, costs/margin/precision, idempotency and all provider
and loss-streak cooldowns remain authoritative. No accounting/history reset.

## Economics and evidence boundary

Each selected entry retains at most 0.5% reconciled current equity inside the
shared 1% setup ceiling. Lots remain dynamic and cost/margin/volume-step bounded.
Native SL and equal gross TP distances are unchanged. Risk-ten-to-earn-one,
shorter TP, increased lots and faster discretionary close are NOT implemented by
this issue. They require separate all-path evidence under #356; shorter gross TP
can be consumed by costs and a high win rate can coexist with negative expectancy.
Unknown counterfactual costs stay null; no negated-P/L reversal claim.

## Qualification and delivery

Positive/failure tests cover persisted fixed admission, rejection of all other
profiles without writes, storage/missing-row failure, fresh default/no-overwrite,
removed authenticated backend route and absent browser controls/proxy. Historical
four-mode lifecycle/recovery tests remain. Full frozen qualification passed all gates and **1,633 tests** (1,080 Node,
115 isolated PostgreSQL, 438 Python), including schema/migration/replay/fail-closed
coverage, formatting/lint/types/build, secret scanning and dependency audits.
Both sample configuration checks and JavaScript syntax passed; AST Graphify was
refreshed with no API cost (document semantics not re-extracted).
[Exact commands, interpreter/source fingerprints and results](evidence/fixed-stop-limit-validation.json)
bind this source. Preliminary formatting/mock typing and stale observer-version
fixture failures were corrected before this frozen successful run.
Operational receipt is recorded in [issue #372](https://github.com/AegisFintech/scalping-bot/issues/372)
after exact-head hosted checks/main merge and same-demo activation. Old frozen registrations/reports stay untouched. No provider/order
forcing or new research promotion is authorized by this cleanup.
