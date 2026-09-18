# ISSUE-108 — Fade-limit reward/risk asymmetry correction

Status: in progress.

The overnight demo sample had 61 winners and 29 losses, but average winners were
about 147.56 while average losses were about 427.28. The high win rate therefore
did not produce positive expectancy, and fees added a further material drag.

Release `0.3.0-fade-limit.2` keeps the existing continuous market-open cycle and
LIMIT OCO workflow. It changes only the locally derived fade exits: SL remains
2.5×ATR and TP increases from 1.0×ATR to 1.5×ATR, with a 0.5 minimum reward/risk
requirement. No time-of-day filter, forced pause, timer cancellation, account
reset, risk increase or live authorization is added. Setups that do not satisfy
the revised economics are rejected while the next scheduled analysis continues.

Results must be compared separately with `0.3.0-fade-limit.1`; this change makes
no profitability or accuracy guarantee.
