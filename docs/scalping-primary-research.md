# Execution-first scalping research agenda

Research date: 2026-10-29. Primary-source review plus the repository's recorded quantitative review; no fresh broker/database query, strategy change or profitability claim. This is an agenda, not a frozen experiment registration.

## What the existing evidence already says

The repository's `docs/quantitative-review-426.md` records 67 closed demo outcomes for **0.7.3**, with 62 winners, five losers and net **−4,825.61 USD**, including signed fees **−3,716.57 USD**. Mean winner +65.28 versus mean loser −1,774.57 implies approximately **96.45%** break-even wins at those observed dollar means, compared with 92.54% observed. Changing volumes prevent treating that ratio as a constant-risk forecast. This is evidence to prioritize payoff/cost analysis, not evidence that reversing direction works.

The same report found duplicate Flight summaries and gaps; three of four uniquely matched losses had positive modeled-net samples. Those are observable sampled excursions, **not proof that a profitable market close was available or executable**. At that report's cutoff, no current **0.8.0** closed trades existed. Requery by immutable release and time before judging the present system. Historical pair results cannot qualify the current single STOP_LIMIT/GTD contract.

## Primary-source findings and their implications

1. **Use the liquidation side and actual costs.** A long closes by selling at bid; a short closes by buying at ask. Midprice or the wrong chart side can falsely imply available profit. Spread also varies with liquidity, session and news. [cTrader prices](https://help.ctrader.com/trading-with-ctrader/markets/)

   The broker schema supplies symbol `pipPosition`, lot size and commission type/rate, plus deal commission, closing details, swap/conversion fees and `moneyDigits`. Decode each field with its own units, retain signed charges, and reconcile entry and exit deals without double counting aggregate fields. The operator's $7 round trip is a hypothesis to verify against actual partial/full fills, not an immutable pip conversion. [cTrader model messages](https://help.ctrader.com/open-api/model-messages/)

2. **Trigger, acceptable price and fill are separate events.** cTrader stop-limit activates a limit order after the stop triggers; rapid movement beyond the limit can leave it unfilled. Tightening the range trades price control against fill probability. A later winning chart does not establish that the order could have executed. Measure both filled outcomes and accepted-but-unfilled/expired orders. [cTrader orders](https://help.ctrader.com/trading-with-ctrader/orders/)

3. **DOM requires causal reconstruction and a limited claim.** cTrader depth is a stream of added and deleted quotes; prices divide by 100000 and sizes by 100 to obtain units. Rebuild the book by quote identity and invalidate it after an unproven reconnect. [Depth subscription](https://help.ctrader.com/open-api/symbol-data/)

   The documented depth event has no source timestamp, while spot timestamps are optional and requested explicitly. Preserve local receipt/order and distinguish them from broker timestamps; never invent a DOM source time or infer exchange queue position. [Open API messages](https://help.ctrader.com/open-api/messages/)

   OTC bullion is bilateral rather than one exchange book. **Inference:** this broker's depth must be labelled broker-local; it cannot be presented as all gold demand or verified institutional positioning. SMC/order-block labels inferred from candles likewise do not establish actual resting orders. [LBMA OTC market](https://www.lbma.org.uk/publications/the-otc-guide/introduction)

4. **Calendar information is useful before textual news interpretation.** BLS publishes schedules in Eastern Time and says releases normally appear within seconds of their official time, but delays can occur. Store scheduled time, source timezone, retrieval time and first locally observed publication separately. [BLS dissemination](https://www.bls.gov/about-bls/dissemination.htm)

   Historical revised macro values are unsuitable as if they were available at an earlier decision: BLS seasonally adjusted CPI can be revised for five years. Preserve the original release vintage and each subsequent revision. [BLS revisions](https://www.bls.gov/cpi/seasonal-adjustment/)

   **Immediate prospective annotation:** BEA's schedule, retrieved 29 October, lists Q3 advance GDP and September Personal Income/Outlays on **2026-10-29 at 08:30 Eastern (12:30 UTC / 20:30 Singapore)**. Recheck the authoritative page before use; this observation neither explains past losses nor creates a trading gate. [BEA schedule](https://www.bea.gov/news/schedule), [BEA prior release confirming EDT](https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026)

5. **Extensive search needs an experiment ledger.** Testing many alternatives against the same history can select false positives. More compute or indicators do not resolve that problem. Retain every trial, pin the baseline and eligibility, reserve untouched chronological evidence, and report uncertainty plus negative results. [Bailey et al., original backtest-overfitting paper](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf)

## Ordered questions and measurable deliverables

| Priority | Question                                                               | Evidence and output required                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Are losses mainly payoff asymmetry, costs or execution?                | Complete release-scoped cohort: actual filled volume, entry/exit VWAP, actual protection, signed fees, net and equity-normalized outcomes; include open/partial/unknown rows. Reconcile broker totals exactly. Report cost per unit and spread/target ratio, loss tail and cohort coverage.                                                                                     |
| 2        | Does inference make a setup stale before placement?                    | Capture → provider available → dispatch → broker accepted → trigger evidence → fill/expiry clocks; per-side quote ages. Report median/p95 delays, price movement during each interval and nonfill/rejection reasons. Unknown trigger time stays unknown.                                                                                                                        |
| 3        | Is there reproducible profit giveback after a usable exit opportunity? | At actual filled volume, record liquidation-side samples and modeled remaining costs; predeclare a small threshold set, realistic reaction/execution delays and adverse-price stress. Measure time above threshold, later return below zero, coverage and gaps. Counterfactual fees/slippage remain null where unobserved; label bounds/scenarios rather than realized savings. |
| 4        | Does breakout confirmation improve the whole eligible cohort?          | Compare one predeclared confirmation rule against unchanged entries/protection, respecting provider availability, broker acceptance, actual order lifetime and skipped/unfilled trades. Do not resimulate a hypothetical sequence of future AI calls from hindsight.                                                                                                            |
| 5        | Do event/session conditions explain failures?                          | Start with calendar-distance and time-of-day descriptive strata, separately marked exploratory. Prospectively capture source versions, local receipt and spreads; later preregister any changed rule. No claim of causal news effect from overlapping events alone.                                                                                                             |
| 6        | Does DOM or an SMC feature add incremental value?                      | Require valid pre-decision broker-local book, spread/depth persistence and feature version. Add one feature to a fixed baseline, include unavailable-book periods, and compare after-cost outcomes, tails and opportunity count on untouched evidence. Do not add many correlated indicators simultaneously.                                                                    |

## Minimum completion standard

Reuse the current evidence bridge, causal replay and durable research plan/result/finding machinery. Each question ends with **supported, rejected or insufficient evidence**, linked to a reproducible result and a closed/blocked plan. Tool-call count is not progress. A useful negative result is progress.

The present recorded dataset supports cost/payoff accounting and limited sampled-path descriptions. It does **not** yet establish counterfactual fills, continuous subsecond exit availability, historical consolidated order flow, a news-surprise edge, or current-release profitability. Provider availability and broker acceptance records are prerequisites for replay; candles alone cannot reconstruct intrabar event ordering.

Start with existing broker/Flight data and free official calendars. A paid low-latency news feed or licensed exchange depth is a separate acquisition only if the incremental experiment needs it; exchange futures depth would still need contract/basis/latency alignment to this CFD. No new paid feed was obtained.

Not checked: current broker/runtime evidence, actual subscribed depth coverage or live commission reconciliation. Risk: demo/replay success cannot guarantee live execution or positive returns; this agenda does not authorize risk changes or automatic strategy promotion.
