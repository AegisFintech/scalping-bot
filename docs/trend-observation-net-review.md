# Current trend evidence and quote clocks — ISSUE-539

The objective is daily net profit after trading costs. Reliable measurement and
correct execution are prerequisites; no daily-profit or economic-qualification
claim is made. This issue preserves the0.11 economic definitions, risk ceilings,
native protections and the ONE existing demo.

## Actual current evidence

At2026-11-05 08:59:11UTC the current programme has110 recorded WAIT contexts,
one failed context, zero order groups and zero close deals. Realized closed-deal
net is zero, with no open journal position or unresolved scoped broker event.
This is a partial Singapore day since02:50:40UTC, not a positive/flat complete
day or account return. Actual model spending, cashflows and broker open marks
remain unavailable in the existing scorecard; zero trading P/L does not imply
zero total operating costs. The retained private snapshot is on `/mnt/sdb`.

For the broader same-account XAUUSD Singapore day fromNovember4 16:00UTC to
November5 09:10UTC, the previous0.10 release has16 actual close deals: gross
-287.35USD, signed fees-1,558.78USD and net-1,846.13USD. The new release's zero
does not erase that loss. This remains a partial-day closed-deal result, excluding
unknown model spend and account cashflows/open marks.

The old frozen loss/R:R methods correctly reject0.11 as unsupported; their methods
were never qualified for this release. All25 contexts in the08:00–08:30UTC window
therefore read UNSUPPORTED. A successful timer did not establish useful current
classification. Old registrations, code and reports remain unchanged.

A retrospective SELECT-only probe of all111 recorded provider contexts before
09:00UTC reused the existing TypeScript geometry. It is not all market opportunities,
a prospective experiment, counterfactual fills or a profit comparison. With the
correct separately retained local capture supplied, the complete classifications are:

| Geometry classification                         | Contexts |
| ----------------------------------------------- | -------: |
| M5 direction unresolved                         |       51 |
| Completed breakout unconfirmed                  |       27 |
| Nearest structural room below risk              |       18 |
| Structural stop outside bounds                  |        3 |
| Structural target unavailable                   |        4 |
| Original entry not executable                   |        4 |
| Geometry available, costs/execution unqualified |        4 |

The four geometry-available cases were still provider WAIT decisions. They do not
establish missed executable winners or authorize overriding WAIT. No retest-profile
context was present at this cutoff. Preserve the finite programme and collect its
full outcomes rather than choosing a winning profile from this sample.

## Reproduced quote-clock defect and repair

The provider's captured_at is broker server time; market_captured_at is separately
recorded local snapshot time. Existing trend geometry compared local quote
receivedAt against captured_at. Ordinary network latency made a causal receipt
appear future relative to the wrong clock. The preliminary recorded-context audit
found30 such geometry rejections, with receipt146–184ms after broker time; these
are offline validator results, not broker rejection counts or proof of lost trades.

Source freshness now uses broker time, and receipt freshness uses local snapshot
time. Retain source-before-receipt, source no later than broker capture, receipt no
later than local capture, separate3-second freshness and0–3second capture skew.
Missing separate local capture retains the historical same-clock behavior.
No timestamp is rewritten, no quote is shifted and no freshness bound is widened.
Tests include normal150ms latency, future receipt/source, stale source and invalid
local capture. The production provider/journal payload and pending lifetime remain.

Migration0043 extends existing handover authority only for the exact reviewed0.11
predecessor de2eead48727 and its unchanged catalogue. Controller and database retain
fresh safe reconciliation, terminal proof, immutable predecessor identity/history,
audited source-handover reason and future successor registration. Unregistered
source drift still refuses advancement. The original0.10 handover remains supported.
No accepted order is force-cancelled to change source. Rollback cannot simply boot
the predecessor against a newer source head: it needs a separately reviewed forward
handover; keep the matched current release and restore it after any failed preflight.

## Separate trend observation

Protocol1.2 registers method trend-observation-1.0 before future half-hour windows.
It retains every context, WAIT/failure/request, causal availability, expired proposal,
missing market and unsupported release. Recorded gross geometry is explicitly
not cost/execution-qualified. Setup reconstruction uses the existing same-snapshot
position clocks and exact broker lifecycle, retaining pending/open/partial/unknown,
zero-fill and closed outcomes with actual signed costs. It applies no legacy
failed-breakout/holding exit hypothesis to retest LIMITs. Counterfactual economics
remain null; the observer cannot call a provider, trade, recover or promote.

Existing1.0/1.1 registrations and archived results keep their original methods.
The new service reads the existing envelope without broker/DB/provider credentials,
network or root-home access, under resource limits. New state lives on `/mnt/sdb`
with its actual mount required, private ownership,2GiB reserve and256MiB study cap.
Source drift, gaps and missed windows remain explicit. Reports never backfill past
prospective windows. A private retrospective compatibility probe is labeled separately.

## Source alignment and next decision

`/root/scalping-bot` now starts from reviewed current main7d51476 on the issue branch.
The old issue255 branch/history and other worktrees remain. Its old populated
environment and development dependencies were preserved privately on `/mnt/sdb`;
the development checkout has matching current dependencies and no automatically
loaded historical environment. Deployment credentials remain protected separately.

Next evaluate the registered complete cohort by profile and Singapore day, retaining
WAIT, failed, expired, unfilled and unknown outcomes. Report actual signed fees,
net payoff/tail loss, completed versus partial days and missing operating costs.
The existing20-close/5-session review floor is only a review floor, not qualification.
A retrospective compatibility probe of the retained08:00–08:30 envelope now
classifies24WAIT and1UNAVAILABLE (availability beyond the cutoff), with zero setups.
It does not replace the original25UNSUPPORTED report or count as future capture.
The failing hourly #319 collector is pinned to0.3 fade exits and has no current
trend authority; its timer was disabled, preserving its code, registration and
reports. Current trend study/feed timers continue.

No shorter TP, larger size, looser admission or automatic strategy promotion follows
from this zero-trade sample. Heavy build/evidence storage uses the available mount.

## Verification and activation

Focused validation initially caught test-fixture revision hashes after mutation;
fixtures now recalculate their own hashes while production retains strict binding.
A new report-context typing error was corrected before full qualification.
The first full qualification stopped at TypeScript checks because the new test
mutated readonly fixture properties directly; it now uses the existing fixture
construction pattern. This was a test-only correction, not a runtime relaxation.
The installed Matt Pocock/Ponytail skills guide behavior-oriented tests, separate
Standards/Spec review and minimal reuse. Graphify0.9.56 and its restored local
skill are available; graph output remains ignored and stored on the mounted disk.
The first qualification runner also stopped before database initialization when
its command PATH omitted `/usr/sbin/runuser`; the complete PATH fixes that runner
environment failure. Independent Standards review requested an isolated receipt-age
boundary test (3000ms accepted,3001ms rejected) and removal of repeated report-type
dispatch; both are implemented and the final Standards/Spec reviews are CLEAR.
All four sample/protected policy/startup configuration checks pass. A mounted
TMPDIR exposed an old security-test assumption about writable `/tmp`; its fixture
now creates an explicit writable ancestor (33 focused isolation tests pass), without
weakening runtime trust checks. Installed GnuPG to execute the encrypted-export
drill rather than accepting its missing-tool skip. A trailing unit-file blank line
was removed before final qualification. Unsuccessful/superseded receipts remain.

Final full qualification passes20 checks and2,956 tests with no skips:1,345 Node,
175 isolated PostgreSQL and1,436 Python. Both dependency audit gates pass; existing
11 moderate npm findings and the Starlette/httpx deprecation warning remain disclosed.
[Source-bound qualification receipt](evidence/trend539-validation.json). Both fresh
independent review axes are CLEAR; all four configuration checks pass. Hosted
exact-head checks, independent GitHub approval, reviewed merge and actual activation
remain required before completion is claimed.

## Prepared deployment checkpoint

[PR540](https://github.com/AegisFintech/scalping-bot/pull/540) carries the qualified
source. The clean source release was built under `/mnt/sdb/scalper/releases/trend539-main`
and passed `release:verify`; source fingerprint is
`ffd04a813a915f4d341375f6db56bb8045461d690b32169b5909f770ca28e630`.
Existing runtime/log links target the unchanged persistent epoch314 state.

Deployment preflight must reverify the artifact, exact-head hosted checks and
independent approval; stop only the existing demo executor to drain inference,
verify current terminal/owned broker evidence, then apply0043 as the local database
owner under the existing migration lock after checking all42 historical checksums.
Start matched protected artifacts and verify actual PIDs/cwds and controller source
handover. Do not clear controls, reset history or claim rollback to an incompatible
old source head. New observer state belongs to scalper-flight, its frozen code to
root; verify feed read access and denied credentials/network before enabling its
separate timer. Future registration must precede its half-hour start. Record actual
capture separately from the retrospective compatibility probe.

The protected branch also requires approval from someone other than the last
pusher. Publish source through its author credential and obtain the independent
reviewer approval on that exact head; do not change branch rules.
