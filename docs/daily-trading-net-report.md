# Daily trading net across releases — ISSUE-541

The operator's objective is net profit at the end of the day. A programme-specific
scorecard is useful for experiments, but switching to a programme with no trades
must not hide earlier same-day losses. At November5 09:10UTC the0.10 programme had
16close deals, gross-287.35USD, signed fees-1,558.78USD and net-1,846.13USD; the
new0.11 programme had zero closes. Its zero did not erase the earlier loss.

## Projection and UI

`daily-trading-net-1.0` is a new independent projection. Existing programme1.0/1.1
schemas, loader semantics and historical results are unchanged. The new
`dailyTradingNet` field in the cached `/api/learning` response scopes to exactly one
configured demo account, XAUUSD, strategy-owned positions and demo order groups.
It includes partial close deals from every linked bot release, with original
broker close time in the current Singapore day and persistence no later than the
read cutoff. Manual positions, other symbols/accounts/modes and later-known rows
are excluded. No cohort ranking or strategy promotion is performed.

One bounded repeatable-read/read-only PostgreSQL snapshot reads identity, at most
5,001close rows and unresolved/open counts. The5,000-row limit,1.5-second statement
timeout,2-second connection timeout and ambiguous/missing-scope/DB-failure handling
withhold the projection rather than emit zero. The existing Decimal daily
summarizer supplies close-deal totals; per-release sums retain signed fees once.
Deals are not positions or position win rates. Deposits are not trade profit.
Current-day values are partial; open broker marks, actual model spending, external
cashflows and account return remain null. This is realized trading net, not total
operating profit or marked account equity. Open/unresolved counts remain visible.

The existing learning theme gains one compact card ahead of programme results:
a prominent realized trading net amount, date/scope/partial-day/fee/exposure details
and release totals. Display amounts round to two decimals; the API retains exact
decimal strings. Exact window/as-of clocks appear separately in smaller text.
Text is emitted through textContent, with a non-identifying configured demo
account/XAUUSD/strategy-owned scope and exact start/cutoff/as-of timestamps. A local
one-second expiry check enforces the30-second age bound even while a GET hangs;
Singapore midnight invalidates the prior day immediately on that local tick.
Missing/offline/stale data clears values independently of programme/research freshness. No new
control, provider call, broker request, dependency or trading-service change.

## Verification and deployment

The summary and frontend regressions failed before implementation and passed
afterward. Tests cover prior-release loss retention, signed fees, Singapore midnight,
half-open cutoff, late persistence, empty versus unavailable, scope/row limits,
partial close deals, manual/other-symbol exclusion and ambiguous identity through
actual isolated SQL. Typed schema parity and existing learning HTTP tests remain.
The security fixture fix in539 makes mounted temporary storage explicit.

Full qualification, independent Standards/Spec reviews, four configuration checks,
hosted exact-head checks and actual rendered/API verification are required before
claiming delivery. Deploy only the read-only dashboard from a qualified artifact;
the executor, provider, Flight, active economic trial and frozen observers keep
their source and state. Rollback restores the prior dashboard path; no migration,
financial row rewrite or accounting reset is required. Bulky artifacts use `/mnt/sdb`.

## Qualified source checkpoint

Final full qualification passes20 checks and2,961 tests/no skips:1,345 Node,175
isolated PostgreSQL and1,441 Python. All four sample/protected policy/startup
configuration checks pass; fresh Standards/Spec reviews are CLEAR after correcting
the SQL5000/5001 boundary gap and adding exact scope/time and independent hung-poll
expiry. Full lint also caught and corrected import order and the test timer's
Promise/void type. Superseded failure receipts remain private.

[Source-bound qualification](evidence/daily541-validation.json). Real Chromium
fixture checks at1440px/390px show the formatted actual earlier loss, explicit
scope, no horizontal overflow and stale withholding; zero control/trading mutations.
This is a fixture browser check using retained read-only totals, not the deployed
API check. API amounts retain exact decimals; display rounding is presentation only.
The same fresh read-only probe reproduces16actual close deals and net-1,846.13USD.
Existing11 moderate npm findings and Starlette/httpx warning remain disclosed.
Hosted exact-head checks, protected merge and dashboard activation remain pending.

## Actual read-only activation

PR542 merged as e917607 after both exact-head hosted jobs and independent approval.
Only the existing dashboard moved to verified sourced63d4f14dba2; the other four
application PIDs remained unchanged and the executor stays on its registered source.
Fresh `/api/learning` readback retains16close deals and net-1,846.13USD with exact
decimals. The served JavaScript matches the prepared artifact. The initial lazy
cache response was loading/unavailable; subsequent bounded polling returned fresh
data, rather than presenting stale values as current.

[Deployment receipt](evidence/daily541-activation.json). Actual deployed Chromium
checks at1440px/390px show the daily card without horizontal overflow; network
observations recorded zero mutations. The independent stale/hung-request tests use
controlled fixtures. This remains realized trading net, with unknown open/model
economics explicit.
