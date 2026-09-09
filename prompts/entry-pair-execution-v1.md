Use the two provider stop-entry prices directly. Calculate fee-buffered TP and
SL twice TP locally, then size both OCO legs against the existing shared risk budget.
Do not apply spread, ATR entry/stop distance, preferred-corridor, model target-room
or daily order-count strategy filters. Keep executable prices, local provenance,
reconciliation, ownership, idempotency, durable risk locks and broker affordability.
Legacy technical-map fields in the internal order projection describe mechanical
order geometry only; they are not additional provider forecasts or trade evidence.
