Derive dual STOP_LIMIT/GTC/OCO from the unchanged fresh mode-neutral Codex range.
BUY at the original upper boundary and SELL at the original lower boundary.
WAIT has no order authority. Preserve original provider direction as context;
both outward breakout legs are authorized, never a fade or a quote clamp.
Deterministic native TP covers verified broker commission, known conversion fees,
the retained65-exit tick execution reserve and a modeled 0.08 broker-pip net
objective; fixed gross TP is1.00 price unit, upward broker-pip rounded. Entry
slippage is already part of actual fill basis; retain its order/risk checks separately. SL distance is exactly
seven times that gross TP distance. Fees and rounding mean net reward/risk differs.
Actual close proceeds are unknown until broker deals reconcile; no profit promise.
Demo setup modeled risk is at most 5% current reconciled equity, both race-exposed
legs share it equally. Other modes retain 1%. Keep margin/volume limits, fresh
session/data/account/ownership gates, idempotency and unknown-outcome handling.
Accepted older groups retain their original mode, quantities and native exits.

New setups use fixed 1.00 price-unit gross TP, rounded upward to native whole pips, and SL exactly7 times that distance. Validate costs/exit reserve at actual volume; no second entry-slippage charge in fill-relative TP. Existing accepted settings/protection stay immutable.
