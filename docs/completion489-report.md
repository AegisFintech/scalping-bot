# Research delivery and execution evidence — ISSUE-489

The implementation repairs stale unsent publication handling and exposes actual
research blockers. It adds a read-only prospective execution-evidence collector;
it changes no entry, exit, provider, position size or risk policy.

## Current economic review

Scope: one demo XAUUSD, release `0.8.0-model-scalp.1-codex.1`, October29 00:00Z
through November2 03:45Z, explicit cutoff and no account-return claim.
[Sanitized accounting and coverage](evidence/completion489-economics.json).

13 closed trades: 10 positive, three negative, net **−USD3,773.14**, signed fees
**−USD1,700.19**, already included. Average winner **USD93.58**; average loser
**−USD1,569.64**; worst **−USD1,658.27**. Gross aggregate is −USD2,072.95, so
fees alone do not explain the deficit. Chronological closed-net peak-to-trough
decline within this cohort isUSD3,879.25; this excludes open P/L, funding and
other releases and is not account-equity drawdown. The small cohort shows loss magnitude
outweighing frequent small wins; it does not qualify a replacement strategy.
All13 have matched close costs, volume-matched entry fills, pre-intent equity and
recorded native-protection mechanism. P/L alone does not identify exact SL/TP cause.
This cohort spans earlier subscription decisions; it is not an API-versus-Codex
comparison and cannot attribute losses to the newly activated API provider.

All13 closed trades match exactly one retained flight summary by direction and
entry/close times, with zero recorded gaps in those13 segments. Other segments
include recorded gaps and remain retained. Sampled quotes are not an executable
complete tick tape. Positive excursions do not prove an earlier close would fill
profitably; counterfactual fees, swap, FX and net proceeds remain unknown.
A separate full decision denominator contains3,796 local analysis decisions,
34 order groups,34 entry orders,13 orders with any fill and13 recorded trades;
21 groups have no recorded trade. These are local decisions, not paid AI requests.
No recorded trade in that decision cohort remains open at the cutoff. This
read-only snapshot observes current stored states and does not reconstruct pending
order status as-of cutoff or prove complete broker absence. The closed-outcome
cohort and decision-created cohort use distinct time inclusion rules.

34 real optional-field acknowledgement rows exist in the bounded cohort. A
separate real02:00–03:00Z November2 export validated two acknowledgements with
ordered broker/receive/persist clocks. Original acknowledgement metadata was not
captured; no historical metadata or fill has been fabricated.

## Measurable next research

Freeze separate chronological training and untouched future evaluation windows.
Compare actual fill-relative target/stop distances and cost share before proposing
any change. Test one exit or entry hypothesis at a time using conditional paired
replay and actual provider/acceptance availability; preserve losing, unresolved,
open and missing paths. A sampled positive excursion is a question for executable
exit research, not proof of available profit. Do not scale lots to repair expectancy.
Timestamped economic news and attributable broker depth are still unavailable in
this audit; collect provenance and coverage before evaluating their predictive use.
These are bounded research hypotheses under #403/#407, not economic activation.

## Publication recovery

The current signed envelope has an expired attestation, only a proposal phase,
and no observed dispatch intent. Retirement requires Root's matching signature,
exact Root-retained bytes, no local commit/push/PR intent and independently absent
remote branch and PR. Publisher and parent share a directory-inode flock.
An immutable receipt precedes an atomic queue-to-archive move, with idempotent
crash recovery preserving the original reason. No attestation is refreshed.
Unknown dispatch, invalid state and unavailable remote evidence keep blocking.
An independently authenticated terminal PR stays intact and permits ordinary
main/evidence admission to continue. No existing PR is reopened or replayed.

Phase directory traversal is scoped to the parent and dashboard publisher group;
phase contents stay private0600. The dashboard reads allowlisted filenames' stat
timestamps only. Resource availability and heartbeat freshness are distinct from
actual publication activity. `/learning` shows generation, reviewer and publisher
blockers plus observed source/time and publication age. Existing `/` is unchanged.
The Python launcher always disables bytecode writes to immutable releases.

## Future evidence collection

The flight recorder records allowlisted metadata from its existing30-second
session/metadata fetch, adding no broker request. Each immutable receipt hashes
request/response times, adapter metadata time, numeric terms and unavailable
fields. Adapter metadata time is not a broker source clock. Account identifiers,
credentials and raw broker payloads are excluded. Actual closing costs remain null.

A dedicated SELECT-only hourly service retains each closed UTC hour, including
empty ACK windows and missing metadata. It links only same-symbol metadata
responses received at most30seconds before an ACK. Future observations never
backfill earlier acknowledgements. The configured account scope is not an
independent broker-account identity proof; original ACK state is never claimed.

A new Root-owned registration freezes a future seven-day collection batch before
its start, with hashes of collector, exporter, receipt/ACK models, recorder source
and policy. Hash drift halts this research only. It freezes local collection code;
it does not attest the upstream market-data gateway or dynamically prove the
currently running trading release. Bundles explicitly remain economically
unqualified. A collection batch, passing fixtures, old losses and a research PR
are not strategy promotion evidence. Existing frozen studies remain unchanged.
Outside the registered window, retained hourly evidence is labelled diagnostic.

## Validation and delivery

Focused regressions:51 pass; Python strict typing110 files passes. Browser checks
pass authentication, blocker/source/age rendering, text injection safety, controls,
mobile width and no JS errors. Full qualification passes all2,609 tests (1,278 Node,147 PostgreSQL lifecycle,
1,184 Python), formatting, lint, TypeScript/build, Python typing, JSON Schemas,
migrations, fail-closed tests, secret scanning and npm/pip audits.
[Qualified-source receipt](evidence/completion489-qualification.json).
Both fresh independent review axes have no remaining P1/P2 findings. Four sample
and existing deployment config checks pass. `graphify update .` completed AST-only.
Reviewed push/merge and coordinated operational activation are the final delivery
steps; actual runtime receipts are recorded on issue#489 after rollout.

Implementation completion is distinct from future outcomes: #466 still requires a
natural independently reviewed merge; #403 still requires independent economic
qualification. Neither can be forced by replaying old data or manufacturing a trade.
