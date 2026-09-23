# cTrader rate-limit recovery — ISSUE-242

## Finding

The transport already paced requests by 20 milliseconds (or 200 milliseconds
for historical requests), but a cTrader rate-limit response did not change
future request scheduling. The rejected request failed, while later requests
could immediately repeat the same pressure. Socket reconnect was only started
after a WebSocket close, so a live socket returning request-level rate limits
could remain unusable until a service restart.

The market-data HTTP server also rediscovered symbol metadata for every quote
and snapshot request. That added two broker requests to normal reads even when
the symbol metadata and schedule had not changed.

## Implementation

- cTrader transport recognizes bounded rate-limit/throttle descriptions and
  applies an exponential request cooldown from 1 second up to 30 seconds.
  The cooldown affects later requests without blindly resending the rejected
  request.
- Successful requests after the cooldown reset the bounded backoff.
- Market-data quote and snapshot reads reuse metadata for 30 seconds. The
  broker-session endpoint still performs fresh discovery, preserving the
  separate 30-second session verification contract.
- Order commands retain their existing no-automatic-retry behavior; a rate
  limit cannot silently duplicate an ambiguous order command.
- Tests cover rate-limit classification and metadata-cache behavior.

## Remaining follow-up

The next observation must confirm the live rate-limit counter does not recur
under normal demo load. If it does, the structured diagnostics from ISSUE-241
will identify the exact operation and broker response for further request
budget tuning. No risk, session, reconciliation, protection, live-authority or
model-fallback gate was weakened.
