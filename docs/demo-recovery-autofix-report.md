# ISSUE-107: Demo reconciliation classification and bounded recovery

Status: in progress.

The demo policy disables financial loss-lock admission, but it does not make
failed accounting evidence safe to ignore. A failed daily/capital reconciliation
therefore sets demo loss-lock status to false while marking reconciliation as
uncertain, zeroing the available risk cap, and blocking new analysis/placement.
This prevents broker accounting errors from being misreported as a demo loss
lock or from permitting risk without verified equity and cash-flow evidence.

The stored daily and high-water measurements, locks and baselines remain intact.
This is a classification and fail-closed behavior correction, not an accounting
reset or a risk increase. The broader bounded recovery work for unknown
reconciliation, duplicate-order prevention, missing protection and stale-data
incidents remains tracked under ISSUE-107.

Broker rejection diagnostics now preserve a sanitized cTrader payload type,
error code and short description in the structured failure event and execution
status. Credentials, tokens and arbitrary payload fields are not recorded. The
stable safety reason remains `CTRADER_REQUEST_REJECTED` while broker-specific
detail is available for diagnosis.

The cTrader cash-flow client now splits requests at the broker's seven-day
maximum and aggregates the validated windows. This removes the recurring
`INCORRECT_BOUNDARIES` failure caused by requesting a long capital-reference
period in one call.

Runtime verification on September 17 confirmed reconciliation succeeded after
the restart: `lastBrokerError` was null, remaining capital risk was `1%`,
automatic analysis was `RUNNING`, and `tradingEnabled` was true. No order was
forced during recovery.

Broker rejection diagnostics now preserve a sanitized cTrader payload type,
error code and short description in the structured failure event. Credentials,
tokens and arbitrary payload fields are not recorded. The stable safety reason
remains `CTRADER_REQUEST_REJECTED` while broker-specific detail is available for
diagnosis.
