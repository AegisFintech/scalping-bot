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
