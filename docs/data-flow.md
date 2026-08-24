# Data Flow and State Machines

## Eligibility preflight

The scheduler asks for one serialized cycle per account/symbol. It rejects before AI work unless every condition is known and true:

1. Services/dependencies are ready and emergency stop/pause are inactive.
2. Account is authenticated, synchronized, and reconciled.
3. Symbol metadata is complete and current.
4. No relevant open, pending, partial, cancellation-pending, unknown, or reconciliation-pending state exists.
5. Last accepted analysis is absent or expired and reconciled.
6. Completed candles are synchronized; depth is complete/fresh; timestamp skew is within tolerance.
7. Daily lockout and AI circuit breaker are inactive.

An in-process cycle mutex prevents overlapping scheduler/manual cycles in one
instance. A partial unique index on active analyses prevents two instances from
creating active cycles for the same account/symbol; the losing insert fails
closed. No PostgreSQL advisory lock is currently used.

## First broker-day baseline

Paper uses its own database identity and may bootstrap a simulated baseline.
Broker demo does not. If its first startup occurs after the configured opening
grace, an authenticated operator can request one baseline while the environment
emergency stop is active and demo submission is disabled. The service samples
empty account-wide reconciliation, account equity/balance, cash-flow history,
and empty deal history twice around the observation window. Changed, nonempty,
missing, or uncertain evidence rejects the request. The baseline and audit event
then commit together exactly once; only a subsequent safety evaluation can clear
the temporary fail-closed daily-risk reason.

## Analysis cycle

1. Obtain authoritative broker/server time and record local receive/monotonic time.
2. Assemble the configured completed 15m/5m/1m bars.
3. Capture top-N depth near the same logical timestamp and freeze immutable inputs.
4. Persist raw snapshot timestamps, skew, completeness, and reconnect flags.
5. Reject excessive age/skew/discontinuity.
6. Call the typed analytics API; persist features and data-quality findings.
7. Query bounded session/setup statistics and calculate deterministic confidence adjustment.
8. Build a full or compact, size-bounded, versioned model request containing
   the non-sizing execution constraints needed for valid conditional levels.
9. Call the AI endpoint with per-attempt timeout/retries/circuit breaker. The
   execution-to-orchestrator deadline covers every configured attempt plus
   bounded grace; invalid or timer-overflowing budgets reject startup.
   A timeout, transport loss, or HTTP 503 opens the execution caller circuit for
   the configured provider reset interval. It blocks during cooldown and
   half-opens only at the exact expiry boundary; the scheduler can then use a
   later fresh broker minute without restarting execution.
10. Size-limit, parse, and JSON-Schema validate the mandatory two-leg proposal.
    Schema 2.0 contains no `NO_TRADE`, leg-enabled switch, or model-controlled
    data-eligibility veto.
11. Reacquire completed candles, metadata, quote, and depth. Reject if the
    completed-candle context or execution metadata changed during inference, or
    if broker time regressed; persist the refreshed quote/depth evidence.
12. Re-run spread protection, then semantically validate and run deterministic
    stop, precision, daily loss, volume, margin, exposure, freshness, and
    duplicate checks against the refreshed execution state.
13. Persist the entire decision trail and outcome transactionally.
14. Select a mode-specific gateway. Replay/backtest/paper simulate; demo may
    submit; shadow cannot; live is deliberately unwired in this release.
15. Record each before/after transition and reconcile external state.

Each newly inserted `audit_events` row creates one outbox row in the same
database transaction. The execution service later sends a bounded redacted
summary to Better Stack. Delivery retries are independent of analysis and
reconciliation, and PostgreSQL remains authoritative. The exported stage
summaries cover snapshot persistence, analytics, model completion, risk intent,
placement, and reconciliation without raw candle arrays, complete model
payloads, account IDs, or broker order IDs.

cTrader demo execution callbacks are independently normalized into a
credential-free versioned record, serialized through a durable PostgreSQL event
journal, and applied atomically to order/fill/position state. Deal IDs provide
fill idempotency; non-deal events use a normalized payload hash. Startup and
reconnect replay bounded broker order/deal history for unresolved local intents.
Synchronous placement callbacks are queued until the OCO placement transaction
has committed both returned broker order IDs, then drained before the analysis
is marked accepted. A strategy-labelled callback that omits its client order ID
may therefore match the durable local intent by broker order ID. Runtime
readiness is recalculated from unresolved journal rows after every drain, so a
final fill can resolve earlier partial-fill evidence without a restart.
Some cTrader servers attach an unpriced position placeholder to a pending
`ORDER_ACCEPTED` event. Because that event has no deal and does not establish a
fill, only its order is mapped; position creation remains exclusive to a fill or
partial-fill event carrying authoritative priced position/deal evidence.
Non-deal cancellation and other lifecycle callbacks may carry the same
context-only placeholder and likewise do not mutate position state. A
broker-created SL/TP close has its own broker order ID and may inherit the entry
client ID; schema `1.1` journals it as a closing child attached to the durable
position without changing the entry order. Its acceptance remains unresolved
until an exact closing deal supplies the terminal position and P/L evidence.
Restart recovery matches known entries by exact broker order ID and can rebuild
a disappeared terminal position from its durable local entry plus the exact
broker closing order/deal. Missing, ambiguous, or multiple close evidence stays
blocking.
Pagination, missing local intent, duplicate-key conflicts, partial fills,
unknown fields/states, or persistence failure make reconciliation uncertain and
block placement.

## Timestamp rules

Every candle has source start/end timestamps and must be closed at or before the authoritative analysis time. Snapshot records include broker/server time, collector receive time, order-book source time, analysis time, and calculated maximum skew/age. Local wall time is diagnostic only. Future timestamps beyond tolerance are invalid.

## Analysis states

```text
PENDING -> COLLECTING -> FEATURED -> MODEL_PENDING -> VALIDATING
                                                       |       |
                                                       v       v
                                                   ACCEPTED  REJECTED
                                                       |
                                                    EXPIRED
```

Any failure transitions to a terminal rejection with reason codes. Accepted output is immutable. Supersession first cancels and reconciles old strategy-owned pending orders.

## OCO states

```text
INTENT_RECORDED -> SUBMITTING -> ACTIVE
                     |            |
                     v            v
             RECONCILIATION   ONE_FILLED -> CANCELLING_PEER
                  REQUIRED                     |
                                               v
                                      POSITION_OPEN / RECONCILIATION_REQUIRED
                                               |
                                          CLOSED / FAILED
```

Each leg has an idempotency key derived from strategy version, account pseudonym, symbol, analysis ID, side, and version. Broker labels identify strategy ownership. A fill (including partial) immediately blocks new analyses and initiates peer cancellation. Duplicate events are acknowledged but do not repeat transitions.

## Expiry and cancellation

On analysis/order expiry, staleness, unsafe spread, account uncertainty, risk breach, emergency stop, invalidated context, or configured shutdown policy:

- mark cancellation intent before external calls;
- cancel only labelled strategy-owned pending orders;
- reconcile broker state;
- classify races/partial fills as blocking uncertainty;
- expire the group only after no active strategy order/position remains.

Manual orders/positions block by default but are not cancelled by default.

## Failure behavior

Missing or ambiguous dependency data produces no order. Safe, permitted cleanup may still cancel obsolete strategy pending orders. Reconciliation continues even if remote logging fails. Database/audit unavailability blocks new demo/live commands. Network timeouts after a broker request are uncertain outcomes, not retry authorization.
