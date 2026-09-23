# cTrader rejection diagnostics — ISSUE-241

## Finding

The market-data service previously reduced every cTrader request rejection to
`CTRADER_REQUEST_REJECTED` at its HTTP boundary. The transport already retained
the broker payload type, bounded error code and bounded description internally,
but the service discarded those details. The operator therefore saw an empty
or generic failure even when cTrader returned a useful reason such as
`BLOCKED_PAYLOAD_TYPE` / `You are being rate limited`.

This milestone does not change admission authority. The service remains
fail-closed for rejected, stale, missing or ambiguous market evidence.

## Implementation

- Market-data session, quote and snapshot failures now preserve a bounded
  `broker` diagnostic when the source is a cTrader rejection, together with
  `operation` and `observedAt`.
- Generic local validation failures retain their existing safe response shape;
  no raw exception object, token, request payload or credential is returned.
- `MarketDataHttpClient` now exposes a typed `MarketDataHttpError` containing
  HTTP status, stable reason and the validated broker diagnostic. Its message
  includes only the bounded broker code and description for operator logs.
- Tests cover broker detail propagation and secret redaction, while preserving
  the existing generic failure contract.

## Follow-up

ISSUE-242 adds request budgeting, rate-limit backoff and automatic transport
recovery. Diagnostics are intentionally delivered first so that recovery can
be measured by exact broker reason rather than by a generic rejection count.

No live execution authority, risk limit, session gate, reconciliation rule,
protection rule or model fallback was changed.
