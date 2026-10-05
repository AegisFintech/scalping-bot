# ISSUE-261 — Observed trading diagnostics

Issue: https://github.com/AegisFintech/scalping-bot/issues/261.

`npm run demo:diagnostics -- RELEASE FROM_UTC UNTIL_UTC` is a bounded, read-only
repeatable-read review. Release and cutoff are explicit, with a 31-day ceiling,
10,000 closed trades, 1,000 entry fills per position, one account/symbol scope,
15-second SQL deadlines and a safe error boundary. It emits no account identifiers,
broker payloads, orders, provider requests or promotion decisions. It is separate
from the frozen learning exporter and forward registration. Historical rows remain
unchanged. Types, JSON Schema and missing/invalid evidence tests accompany it.

Each trade reports net P/L as a percentage of its reconciled risk-decision equity
available before group intent. These are individual trade ratios, **not an account
return, portfolio backtest, summed return or actual stop-risk R**. Missing, late or
invalid equity stays null. Owned entry fills must match the exact position/group,
side, account and symbol and the fully filled order volume; partial or missing
volume leaves VWAP unknown. Costs use the existing exact close-event projection
and signed component reconciliation. Exact SL versus TP reason, actual filled
stop risk and provider cost remain null.

Protection counts refer only to journaled broker observations within the position
lifetime. Verified samples need positive SL and TP; missing-stop samples are
explicit. Sampling does not prove continuous protection or authorize retrospective
changes. Counts are aggregated in SQL to avoid transferring thousands of repeated
samples. A materialized cohort prevents repeated full protection-journal scans;
invalid payloads or deadlines fail explicitly rather than returning partial proof.
No SQL schema change or deployment is required.

Fixed actual demo cohort, September 21 00:00 through October 5 02:00 UTC, release
`0.3.0-fade-limit.3`: **159 trades**. All 159 match pre-intent equity, entry fill
volume, at least one historical protection sample and exact close cost evidence.
The private artifact is `/tmp/scalper-diagnostics-261.json`; individual financial
rows are not uploaded to GitHub. The earlier economic review remains negative:
net **-2,228.62**, gross **1,227.45**, signed costs **-3,456.07**, profit factor
**0.9257**. Matched evidence does not establish profitability or an entry/TP upgrade.

Validation: focused diagnostics/schema tests (6 passed), TypeScript and changed
ESLint pass. Initial broad SQL review hit the 15-second deadline; repeated journal
scans were replaced by the bounded cohort projection, and the same frozen window
then completed. Full cross-batch qualification is recorded separately. Rollback:
stop using this optional review command; no trading state needs rollback.
