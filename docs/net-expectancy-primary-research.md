# Primary research for faster XAUUSD DEMO experiments

Accessed **2026-11-03**. Official cTrader documentation, author-hosted research and
official calendars were retrieved successfully with the web tool. This note is
research for a proposed experiment plan: no deployment, orders, provider calls,
risk-policy change or experiment registration. Proposed numbers below are test
choices, not externally established optimal settings.

## Execution facts that change the experiment

**Entry price control exchanges execution certainty for nonfills.** A cTrader
STOP becomes a market order after its trigger; STOP_LIMIT activates a limit order
within its range. Price can pass through the range without execution. Therefore
record accepted, triggered, filled, partially filled and expired outcomes
separately. A winning subsequent candle cannot establish an executable entry.
[cTrader order semantics](https://help.ctrader.com/trading-with-ctrader/orders/)

Default trade-side triggers use ask for buys and bid for sells. cTrader also
documents opposite-side and two-consecutive-tick trigger options. These are broker
trigger choices, not completed-candle confirmation. A pending order triggered
shortly before expiry can fill after its selected expiry time; an expiry timestamp
alone is insufficient terminal proof.
[cTrader order parameters and expiry warning](https://help.ctrader.com/ctrader/trading/orders/)

**Native TP is not evidence of guaranteed limit-price execution.** The official
orders guide describes both SL and TP as closing at the best available market
price when triggered. Its separate LIMIT instruction executes at its limit or
better but may remain unfilled. Therefore do not assume a native TP has the
fill-price guarantee of an explicit profit-taking LIMIT. A proposed limit-close
alternative needs verified API support and actual position/ownership behavior;
otherwise it remains hypothetical.
[cTrader order and protection semantics](https://help.ctrader.com/trading-with-ctrader/orders/)

Native protections remain active after the app session ends. A stop moved to entry
with zero offset can still produce a net loss; the protection guide explicitly
identifies costs/slippage. An early-exit candidate therefore needs executable net
proceeds and broker closing evidence, not a green chart or an entry-price stop.
[cTrader protections](https://help.ctrader.com/ctrader/trading/protections/)

Long liquidation uses bid; short liquidation uses ask. Spread varies with trading
conditions, including session and news. **Inference:** compare entry buffer and
confirmation using the correct side and observed spread, rather than midprice;
do not deduct spread again when it is already embedded in entry/exit prices.
[cTrader bid/ask and spread](https://help.ctrader.com/trading-with-ctrader/markets/)

The API exposes deal execution price/time and filled volume; closing detail has
gross profit, commission, swap, conversion fee and monetary precision. Commission
rates have several bases and broker minimums. **Inference:** reconcile signed
charges to actual fills without counting an aggregate and its components twice.
Unknown counterfactual closing charges remain null.
[cTrader API model fields](https://help.ctrader.com/open-api/model-messages/)

## Actual costs, reserves and reward/risk

The repository's [cost-balanced contract](cost-balanced-scalp-report.md) separates
modeled commission from a **65-tick adverse-exit reserve**. With tick size0.01,
the reserve is0.65 price units. A quoted total near0.888 containing roughly 0.238
modeled commission is therefore **not observed commission0.888**. The reserve is
neither a realized debit nor a verified maximum execution loss. This note makes
no fresh broker-cost measurement.

For a simplified constant-volume, two-outcome scenario, let target distance be
`T`, stop distance `S`, and round-trip actual cost in price units `c`:

```text
net win = T-c; net loss magnitude = S+c
break-even win fraction = (S+c)/(T+S)
```

This is algebra, not an estimated edge. For an illustrative `S=1`, `c=0.238`,
targets1/1.5/2 imply break-even wins61.9%/49.5%/41.3%. Actual spread-side geometry,
slippage, partial exits and changing volume invalidate a mechanical application.
If the reserve0.65 is included in `c`, label the result **stress admission**, not
observed-cost expectancy. The existing policy has its own conversion/reserve
formula; this illustration does not replace it.

## Validation without a magic trade count

Bailey, Borwein, López de Prado and Zhu show how selecting among many backtests
creates false discoveries. Their discussion explains why a holdout alone does
not account for the number of trials. **Practical inference:** retain every
candidate and failed result, including informal parameter trials; do not repeatedly
inspect and retune against a supposedly untouched future segment.
[Author-hosted probability of backtest overfitting paper](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)

Bailey and López de Prado's Deflated Sharpe Ratio accounts for multiple testing
and non-normal returns; its inputs include track-record length, skewness,
kurtosis and trial information. **Practical inference:**20/100/1,000 trades or30
calendar days is not a universal qualification threshold. More correlated trades
within one market episode do not establish coverage of future conditions.
Statistical adjustments also require their assumptions and adequate evidence;
they cannot convert missing costs or fills into observations.
[Author-hosted Deflated Sharpe Ratio paper](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)

Hyndman and Athanasopoulos describe rolling-origin evaluation in which each
training set precedes its test observations. **Practical inference:** develop on
earlier evidence, freeze rules before later windows, then evaluate sequentially.
Keep overlapping trade paths together across boundaries and preserve open/gap
censoring. Chronology prevents future-data use; it does not by itself remove
multiple-testing bias.
[Authors' time-series cross-validation chapter](https://otexts.com/fpptr/tscv.html)

## Proposed practical experiment loop

Use existing read-only causal replay to reject impossible ideas quickly; its
counterfactual fills/costs remain simulated or unknown. Use actual broker DEMO
fills to measure execution and net results. Unlimited demo funding permits more
experiments, but deposits are cashflow rather than profit and resets must not
erase a losing record.

Freeze a baseline and a small sequential set, changing one dimension at a time:

| Question     | Concrete comparison to preregister                                                                                        | Required trade-off measurement                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| TP/SL        | Current net-cost rule versus one alternative net reward/loss threshold, with explicit base versus stress cost assumptions | Net payoff, loss tail, holding time, eligible frequency |
| Entry range  | Existing30ticks versus10ticks                                                                                             | Worse fills avoided versus triggered nonfills           |
| Confirmation | Existing rule versus one extra completed-M1 close                                                                         | Avoided false breaks versus later/missed entries        |
| Expiry       | One fixed60s versus180s capture lifetime                                                                                  | Available placement time, nonfills, late-fill races     |
| Early exit   | Native-only versus a separately implemented fixed maximum-hold rule                                                       | Actual close proceeds, fees, latency, unknown dispatch  |

These candidates need independent implementation/authorization before broker
testing; they are not simultaneous changes or automatic promotions. Inference
latency consumes entry lifetime. Accelerate collection by eliminating avoidable
downtime and measuring reasons for waiting, while retaining active-group,
reconciliation, freshness, affordability and cooldown gates. Do not force trades
or recycle an uncertain order to meet a count.

Predeclare start/end, runtime/source hashes, eligible opportunities and daily
cutoff. Report actual net/day and its uncertainty, positive/negative/flat days,
eligible/no-trade/unfilled/open/partial/unknown outcomes, throughput and exposure
time. Separate realized closed-trade net from marked open equity. Cashflow-adjusted
equity change is end equity minus start equity minus net external deposits;
unavailable equity marks remain unknown. Compare equity-normalized results as
well as dollars when quantity changes. Neither high win rate nor more fills is
the objective by itself; test after-cost daily expectancy and its downside.

Annotate scheduled releases prospectively using free official sources, recording
retrieval time and timezone. BLS labels its calendar Eastern Time; the Fed lists
FOMC meeting dates. Event stratification is initially descriptive, not evidence
that a news filter improves expectancy. No purchased feed is needed for this step.
[BLS schedule](https://www.bls.gov/schedule/),
[Federal Reserve calendar](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)

This research establishes execution constraints and an evidence method. It does
not establish an XAUUSD edge, guarantee a profitable day, or qualify DEMO results
as live execution evidence.
