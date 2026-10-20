# ISSUE-340 — Dark trading command centre

Issue: https://github.com/AegisFintech/scalping-bot/issues/340.
Status: implemented and fully qualified; checked PR and dashboard-only deployment pending.

## Presentation and evidence

The operator approved adapting the reference video's command-centre style to a
clear dark interface, prioritizing current action, decision factors and P/L.
Overview now contains an observed workflow, current action / next step, four large
financial metrics, completed M1/M5/M15 charts, proposed/intended/verified levels,
recorded indicators, deterministic validation/risk evidence, closed-net curve,
position/protection tables and recent decision activity. Native metrics preserve
accessible text; profit/loss colours supplement numeric signs. Responsive cards
and reduced-motion support keep the design usable on small screens.

Overview / Trade history / Diagnostics navigation and audited operator forms stay
outside timed fragments. Every fragment-owned element is emitted on each tick;
stable keys preserve chart selection and forms. Workers do bounded read-only reads
and never call Streamlit or send trading/control mutations. Existing explicit
operator control submission remains authenticated, audited and unchanged.

All new database reads originate from one exact account/symbol/mode identity.
Prefer the active group's own analysis/context instead of an unrelated last
background check. Internal query identifiers are removed before presentation.
The latest 80 candles per timeframe from exact bounded provider input supply the grid when
available; otherwise charts explicitly identify the recorded execution snapshot.
The original provider levels are distinct from order intentions and fresh broker
SL/TP. A shaded buffered entry corridor is not claimed to be an exact unreturned
support/resistance box. Chart axes display GMT+8 independently of browser timezone.

Indicators are recorded context, not invented execution gates or Codex reasoning.
Codex returns two prices, so narrative reasoning, exact box edges and confidence
remain unavailable. Current spread is freshness checked; consolidated exchange
order flow and news are not invented. Unobserved download/processing transitions
are not animated as if timed telemetry existed. Paused/stopped states describe
continued protection/reconciliation and the actual required next step.

Financial values retain existing freshness and decimal rules. Open broker net,
gross and recorded signed commission are separate observations. Future closing
fees/swap are unavailable, never inferred as zero. Realized net already includes
broker fees. The latest 300 closed outcomes form a cumulative closed-net curve,
explicitly not account equity or a return series. Approved leg budgets are modeled
allocations, not actual stop risk. Unavailable data is withheld rather than shown
as a healthy flat account. Stale protection is never labelled verified.

## Scope and rollout

No order, strategy, prompt, risk, journal, schema migration or registered research
change. Python dashboard imports use explicit package names, including diagnostics,
to avoid duplicate modules in runtime and typed tests. No dependency additions.
The new matching immutable artifact will be selected for the dashboard alone;
existing market/AI/execution/analytics processes and registered trading artifact
remain running at their existing paths. Preserve environment, credentials, current
positions/GTC/protection and the canonical prospective registration. Rollback
recreates only the dashboard using its previous artifact against the current DB.

## Verification

Focused Python tests cover freshness, missing costs, paused protection, genuine
workflow states, proposed/intended/verified levels, HTML escaping, scoped bounded
reads, opaque identifier removal and malformed/forming/oversized provider grids.
Existing outage, unauthorized controls, background polling and chart tests remain.
Browser verification uses a private loopback preview: desktop 1512px and mobile
390px, all three views, M5 selection across fragment ticks, typed but unsubmitted
control fields across ticks, no page/Streamlit exceptions or horizontal overflow.
Real financial screenshots stay private outside Git. Preview reads do not force
provider dispatch or trading orders. Full gate results and rollout follow below.

Full qualification passed at `/tmp/scalper-qualification-NcGrM4/checks/results.json`:
942 Node / 94 isolated PostgreSQL / 389 Python tests; all formatting, linting,
TypeScript/build, Python formatting/lint/mypy, schema/migration/fail-closed, secret
scan and npm/pip audit gates passed. Both policy and `--startup` configuration
checks passed against the existing protected environment. Focused dashboard suite:
43 tests, including existing charts/background coverage. Browser light-base
compatibility passed with native inputs and four visible metrics. AST-only Graphify
updated. Earlier interrupted runs are not qualification. Known Starlette/httpx and
Graphify pyproject warnings remain. [Sanitized results](evidence/dashboard-command-centre-validation.json).
