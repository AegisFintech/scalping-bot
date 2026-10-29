# Directional GTD gateway incident

[Issue 425](https://github.com/AegisFintech/scalping-bot/issues/425) tracks
the fix and separate recovery of the existing demo entry.

On October 28 at 23:16 UTC, the current scalp release persisted an entry intent
and then recorded `DEMO_DIRECTIONAL_COMMAND_INVALID`. Its directional gateway
accepted only GTC even though the release uses STOP_LIMIT/GTD. A focused test
reproduced the same failure before dispatch. The order later expired locally and
entered cancellation recovery without a broker ID, local unsent proof or mapped
broker event. The durable rejection and source sequence support a pre-dispatch
diagnosis, but do not by themselves authorize rewriting the existing incident.

The gateway now admits GTD for directional STOP_LIMIT orders, preserving the
broker client's exact lifetime acknowledgement and all existing gates. On restart,
recovery of a pending GTD order also requires the same broker expiry. No unknown
placement is retried. Tests reproduce both prior failures, cover exact expiry,
unknown dispatch and invalid GTD LIMIT, and retain broker lifetime tests.

The stuck order requires a separately reviewed, incident-specific evidence and
recovery procedure, tracked in [issue 427](https://github.com/AegisFintech/scalping-bot/issues/427).
Passing tests does not establish its broker outcome or trading
performance. No history, accounting, strategy or risk policy was reset.

On October 29, a separate demo broker connection with order commands disabled
queried the complete account order and deal history from 23:11:11 UTC October 28
through 01:06:29 UTC October 29. Neither history response reported more pages;
there was no matching order and no deal in the window. Fresh reconciliation
returned no open orders or positions. This supports the audit evidence but does
not by itself establish non-dispatch or authorize clearing uncertainty.

## Qualification

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed: 1,178 Node tests,
132 PostgreSQL lifecycle tests and 670 Python tests. Formatting, lint, types,
build, secret scan and both dependency audits passed. The 141 focused gateway
and broker tests also passed. Qualification source SHA-256:
`3a007e745f95d032813dde165f81029ad953b0d42da8ca9966f9775d612f4304`.
The initial pre-fix regression and the pre-fix expiry-recovery regression both
failed for the expected reasons; their corrected tests pass.
