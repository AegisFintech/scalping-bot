Derive dual STOP_LIMIT/GTC/OCO from the unchanged fresh mode-neutral Codex range.
BUY at the original upper boundary and SELL at the original lower boundary.
WAIT has no order authority. Preserve original provider direction as context;
both outward breakout legs are authorized, never a fade or a quote clamp.
Deterministic native TP covers verified broker commission, known conversion fees,
existing 30-entry/65-exit tick execution reserves and a modeled 0.08 broker-pip net
objective; round gross TP upward to valid broker precision. SL distance is exactly
seven times that gross TP distance. Fees and rounding mean net reward/risk differs.
Actual close proceeds are unknown until broker deals reconcile; no profit promise.
Demo setup modeled risk is at most 5% current reconciled equity, both race-exposed
legs share it equally. Other modes retain 1%. Keep margin/volume limits, fresh
session/data/account/ownership gates, idempotency and unknown-outcome handling.
Accepted older groups retain their original mode, quantities and native exits.
