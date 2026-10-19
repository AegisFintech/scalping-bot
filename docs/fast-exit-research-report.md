# ISSUE-319 — Cost-aware fast-exit conditional research

Issue: https://github.com/AegisFintech/scalping-bot/issues/319.

## Authority and candidates

This is an isolated observer, with no broker client, order command, provider call,
strategy promotion, risk reset or production import. The current fade entry,
SL/TP and shared 1% current-equity ceiling stay unchanged. A 30-day batch collects
observations; it is not sufficient qualification. Economic release review remains
separate. The operator's subsequently described discretionary breakout method is
a distinct entry experiment, not represented by this fade-exit comparison.

Frozen candidates retain the current fill-relative SL/TP:

- Baseline: original broker protection only.
- Quick: trigger a local close at the pre-intent price-equivalent fee estimate,
  plus the assumed adverse exit reserve, plus 0.10 original stop distances.
- Giveback: arm above fees/reserve plus 0.25 stop distances, then trigger when price
  gives back 0.10 stop distances, with a trigger floor at fees/reserve plus 0.05.

The close uses the first sampled executable bid (long) or ask (short) at/after
500 ms assumed latency, minus a 0.65 price reserve. Stress uses 1 second, doubled
spread and 1.30 reserve. These are assumptions, not measured execution guarantees.
Native SL/TP remains independent and takes precedence if crossed while a local
close is pending. An exit can lose money after a profitable trigger. Neither
candidate widens stops, increases volume or takes a hindsight peak as its fill.
Actual net P/L, fees, swap, FX and margin under alternative exits stay null.
A fee-price estimate is admission evidence, not known counterfactual cost.

## Input and censoring

The new typed `FAST_EXIT_INPUT_V1` exporter uses repeatable-read/read-only SQL,
a 15-second statement timeout, a 1,000-intent limit and exactly one account/symbol
scope. Exact Codex release identity is required. Provider availability and mapped
broker acceptance events are reused; `orders.submitted_at` is never eligibility.
One full observed fill plus explicit received peer cancellation is required.
Partial/multiple fills, OCO races, pending peers, unusable fee evidence and invalid
intents remain excluded with explicit denominators. Candidate local exits only
begin after peer cancellation; original broker protection remains active earlier.
Fee evidence must be unique, pre-intent, exact-volume and match the original TP.

The existing verified sampled tape loader and setup parser are reused without
changing the frozen #255 sources. Gaps over 3 seconds and rejected observations
censor paths, as do open/pending exits at daily cutoff. Source timestamps before
fill cannot trigger an exit. No interpolation or candle-high/low reconstruction.
Every case/status is preserved; complete-pair gross price-over-stop differences
are labelled selected subsets, not net expectancy or dynamic portfolio returns.
A hypothetical earlier exit could change later opportunities; this conditional
experiment does not simulate that request stream or dynamically resize quantities.

## Exploratory result (not validation)

Window: October 19, 2026, 07:00–12:00 UTC. 14 recorded intents; one double-fill
setup excluded, 13 eligible. Tape: 62 sealed segments / 71,246 sampled quotes.
Input digest `2f2a40eebb2c507cc05eaf65960fe67e5477a8de16e2aefaadc6c8806cf23cce`.
The original exploratory report is preserved privately and is not overwritten.

Base: baseline 4 TP / 7 SL / 2 gaps; quick 5 fast exits / 1 TP / 6 SL / 1 gap;
giveback 4 fast exits / 1 TP / 7 SL / 1 gap. Among 11 complete baseline/candidate
pairs, quick gross delta summed over original stop distances was -0.4939;
giveback -1.5297. Stress complete-pair deltas: quick -1.7248; giveback 0.
Two unresolved pairs remain in each comparison. These are gross conditional
selected subsets, not dollar returns or a claim of statistical superiority.
They do not support promoting faster exits. Candidates remain unchanged after
seeing these results; no parameter optimization or removal of losing paths.

## Prospective collection and operations

`python -m python.backtest.fast_exits register --start FUTURE_UTC --output registration.json`
creates an exclusive source/candidate/release-pinned 30-day registration. Start
must be in the next 24 hours. `collect` processes at most one eligible daily
window per call after a ten-minute settlement delay. A file lock prevents duplicate
workers. It verifies prior report checksums and registration identity; reports
contain their frozen input and are atomically published without overwrite.
Source drift, invalid evidence or disk reserve failures stop research only.
The original #255 registration, observer and reports remain untouched.

The supplied service/timer run hourly from an isolated frozen artifact, using only
the trusted read-only exporter. CPU 50%, memory 2 GiB, no swap, 10-minute timeout,
32 MiB output and 2 GiB/15% disk reserve. Existing storage retention controls quote
segments; the input and tape digests do not themselves retain all original quote
bytes. Do not claim long-term independent path reproducibility without retaining
those segments. No new off-host backup is configured or claimed.

Full local qualification passes: `npm run qualify`, evidence
`/tmp/scalper-qualification-gSffJ6/checks`: 888 Node, 90 isolated PostgreSQL and
361 Python tests, with formatting/lint/types/build/schema/migration/fail-closed,
secret scan and both dependency audits. Focused tests: 22 Python, 2 Node/schema.
Registered before outcomes for October 20 00:00 UTC through November 19 00:00 UTC,
using isolated qualified artifact `1bc1ac8` at `/opt/scalper-fast-exit-research`.
The committed registration is `docs/evidence/fast-exit-study-319.json`.
The separate hourly timer is enabled. Its sandboxed first run returned
`WAITING_FOR_WINDOW` with exit 0, without exporting data or issuing a provider call.
First daily window is eligible October 21 00:10 UTC; the hourly timer should collect
it around 01:00 UTC. No future outcome is available yet. The separate manual breakout proposal is
https://github.com/AegisFintech/scalping-bot/issues/321; its private financial
review and discretionary rules are not copied into the production policy. Rollback disables only the new research timer/service and preserves
all registrations/reports. Trading services and accepted orders are independent.
