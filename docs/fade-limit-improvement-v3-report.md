# ISSUE-110 — Fade-limit v3 expectancy correction

The current demo release had a high win rate but negative expectancy because
average winners were too small and fees consumed a material share of gross
returns. The existing replay artifacts repeatedly ranked the trend-aligned
fade family with a 2.0×ATR target above the 1.5×ATR target under base, spread,
commission, and entry-pierce stress.

Release `0.3.0-fade-limit.3` therefore changes only new fade proposals:

- SL remains `2.5×ATR`.
- TP increases from `1.5×ATR` to `2.0×ATR`.
- Minimum reward/risk increases from `0.5` to `0.75`.
- Expected net profit must exceed 1.5× estimated fees.
- The market-open analysis → protected LIMIT OCO → reconciliation → repeat
  flow remains unchanged.
- Shared 1% current-equity setup risk, broker sizing, protection, ownership,
  stale-data, session, and reconciliation gates remain unchanged.

The execution worker now retries transient local market-data HTTP 503 responses
up to three times. It does not retry stale, invalid, broker, or unknown-order
evidence and does not bypass fail-closed handling.

This is an experiment, not a profitability or accuracy guarantee. Compare v3
only against v2 after at least 100–200 same-release closed trades, including
fees and slippage. Do not rewrite historical release rows.
