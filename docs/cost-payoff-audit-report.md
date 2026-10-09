# ISSUE-276 — Expected costs and realized payoff

Issue: https://github.com/AegisFintech/scalping-bot/issues/276.
PR: https://github.com/AegisFintech/scalping-bot/pull/277.
Dependencies: #262 results review and #255 prospective research. This is an
isolated read-only audit; the running demo and frozen study remain unchanged.

## Findings

Fixed release `0.3.0-fade-limit.3`, closed demo trades from September 21 00:00 UTC
through October 9 00:50 UTC exclusive. All 197 retained trades match pre-intent
fee estimates to the exact side, entry, target and fully filled owned volume.
All terminal cost components reconcile. The October 5 02:00 UTC split was retained
from the previous review; it is not an engineering-deployment causal comparison.

| Measurement                             |               Full cohort |  New interval |
| --------------------------------------- | ------------------------: | ------------: |
| Closed trades / wins                    |                 197 / 107 |       38 / 20 |
| Gross P/L                               |                    511.60 |       -715.85 |
| Signed costs                            |                 -4,447.51 |       -991.44 |
| Net P/L                                 |                 -3,935.91 |     -1,707.29 |
| Modeled round-trip commissions          |             4,692.5989518 | 1,066.8087648 |
| Actual commission costs                 |                  4,692.37 |      1,066.88 |
| Actual minus modeled commission         |                -0.2289518 |    +0.0712352 |
| Adverse / favorable / equal entry fills |              0 / 181 / 16 |    0 / 35 / 3 |
| Intended TP / SL price-distance range   | 0.7950310559–0.8037974683 |    same range |

Amounts use the journal's account currency. Slippage is signed in XAUUSD price
units, relative to the approved limit, with positive meaning adverse for either
side. Favorable entry fills do not measure exit slippage, spread costs or execution
quality against a market benchmark. The observed limit-fill prices have no adverse
violations; this does not establish complete tick coverage.

**Commission underestimation is not the observed problem.** Actual fees were
already included in sizing and target checks. The modeled target gross/net totals
are hypothetical target-hit amounts, not achievable portfolio P/L or additional
profits. They exclude swap and provider costs and cannot be compared as if every
trade should have won. Aggregate commission differences reflect actual exit
prices and broker rounding; their small size does not prove a universal fee model.

The realized mean winner/loss is 308.48/410.48 overall and 262.76/386.80 in the new
interval. Holding those historical means fixed gives arithmetic break-even win
shares of 57.09% and 59.55%, above observed 54.31% and 52.63%. These are descriptive
sample calculations, not forecasts, constant-risk returns or promotion thresholds.
Dynamic equity and volumes make raw dollars unsuitable for a constant-risk
strategy comparison. Recent gross losses also show that fees alone do not explain
the deterioration.

## Implementation and limits

`npm run demo:cost-payoff -- RELEASE FROM UNTIL` exports the new strict
`cost-payoff-audit-1.0` schema, leaving earlier diagnostics contracts unchanged.
Use explicit UTC bounds, at most 31 days and 10,000 closed trades. The exporter
uses repeatable-read/read-only SQL, a 15-second statement timeout, a 30-second idle
transaction timeout and a five-second connection timeout. It rolls back before
output. It exports no account/order IDs, raw broker events or credentials.

Only one accepted pre-intent actual-volume fee-buffer record is eligible. Wrong
side, entry, target, volume, time, inconsistent fee arithmetic or duplicate
records produce null estimates; no latest-record selection or current-broker
metadata reconstruction. Matched estimates describe the original target, not
fees at the eventual exit. Actual commission comparisons require reconciled close
components. Partial or missing entry fills have null VWAP/slippage.

Geometry is **intended order geometry**, not an assertion of executed broker SL/TP
or actual filled stop risk. Actual stop risk, exact SL-versus-TP exit reason and
provider cost remain null. Sampled verified protection is reported separately
and cannot establish continuous protection. No broker command, inference,
strategy promotion, accounting transition or live execution is authorized here.

## Next economic work

Retain production economics. Use the already frozen #255 paired prospective
entry/TP comparisons with all eligible paths and censoring retained. The first
six windows were HOLD; the 30-day collection ends November 1 04:00 UTC and is not
qualification. Do not alter registered candidates to fit this cohort or promote
from selected complete winners. A different TP ratio or model-entry transform
requires independent evidence and a separately reviewed economic release.

## Validation

Initial full qualification stopped at lint: seven type-only import/unnecessary
assertion violations in the new module. These were corrected; no runtime failure
was concealed. The second run passed 829 Node tests in 108 files and all source,
Python static and secret checks, then stopped at newly detected npm advisories:
`fast-copy` GHSA-jggr-w7fw-pc2j (moderate) and `source-map-js`
GHSA-68fv-2mgg-jv7q (high). `npm audit fix --ignore-scripts` changed only two
development transitive resolutions: fast-copy 4.0.4 → 4.1.2 and source-map-js
1.2.1 → 1.2.2. npm audit then reported zero vulnerabilities. Production dependency
pins and the original frozen checkout remain unchanged. The complete rerun passed **829 Node / 70 isolated database / 261 Python tests**,
no skips. Formatting, ESLint, TypeScript checks/build, Python Ruff/mypy,
JSON Schema/migrations/replay/fail-closed suites, secret scanning and npm/pip audits
all pass. Exact wrapper subcommands, durations and the pre-receipt source hash:
[cost/payoff qualification](evidence/cost-payoff-validation.json).

Commands: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` (Node 22.23.2;
Python 3.13.5; isolated PostgreSQL TLS, no production database writes);
`node node_modules/vitest/vitest.mjs run tests/evaluation/cost-payoff-audit.test.ts
tests/schema/cost-payoff-audit.test.ts` (five focused tests pass);
`graphify update .` (AST-only; 5,317 nodes / 10,274 edges; existing empty
pyproject.toml warning). The 197-row private export also validates against the
new strict schema. Original frozen checkout remains clean at 984f479.
Final documentation receipts are written after qualification; hosted checks qualify
the actual committed PR head before merge. Local private export:

```sh
npm run demo:cost-payoff -- 0.3.0-fade-limit.3 \
  2026-09-21T00:00:00.000Z 2026-10-09T00:50:00.000Z
```

Individual observations remain in mode-0600 local artifacts. Only aggregate
findings are committed; historical journals, observer registrations and reports
are not rewritten.
