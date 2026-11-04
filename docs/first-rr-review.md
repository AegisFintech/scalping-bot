# First R:R review — ISSUE-534

Decision: keep collecting the existing registered demo experiment. These observations
do not support deploying shorter TP, larger TP, a structural ratio filter or a timed
exit yet. This completes the first review and candidate comparison; it does not
complete parent529 evaluation or403 economic qualification. No new economic release
or change to active orders is authorized by this report.

## Scope and actual outcomes

Three immutable protocol1.1 windows cover2026-11-04 10:30–12:00UTC. Their input/report
pairs remain in `/var/lib/scalper-rr532`; nothing was regenerated or overwritten.
There are47 context appearances:30WAIT,13REJECT_GEOMETRY,2PASS_GEOMETRY and2UNAVAILABLE.
These are diagnostic classifications, not broker rejection counts or paid calls.
There are17 setup appearances across15 distinct setups:4 closed,10 distinct proven
zero-fill terminals and1 unresolved at the final cutoff. Three UNKNOWN appearances
are retained in their original windows; two later resolve to zero-fill terminals.
Do not sum repeated appearances as distinct trades or silently drop unknowns.

| Entry UTC    | Close UTC    | Side | Planned entry | Planned SL | Planned TP | Actual entry | Signed fees USD | Closed net USD |
| ------------ | ------------ | ---- | ------------- | ---------- | ---------- | ------------ | --------------- | -------------- |
| 10:32:29.925 | 10:43:22.112 | SELL | 4042.30       | 4047.75    | 4041.30    | 4042.16      | -65.47          | 218.03         |
| 10:58:59.866 | 10:59:10.543 | BUY  | 4045.52       | 4041.34    | 4046.52    | 4045.82      | -82.06          | 320.16         |
| 11:35:20.817 | 11:36:39.253 | SELL | 4040.96       | 4043.00    | 4039.96    | 4040.73      | -142.60         | -1447.96       |
| 11:56:25.678 | 11:57:30.964 | SELL | 4040.38       | 4041.86    | 4039.38    | 4040.16      | -172.63         | -1432.87       |

These four closed trades total **-2342.64USD**, including462.76USD signed fees
in magnitude and zero recorded swap. Wins total538.19; losses total2880.83.
Mean loss magnitude1440.415 is about5.35times mean win269.095. This is a four-trade
scoped observation, not a whole-day/account result, a stationary distribution or
proof of long-term performance. Dynamic volume differs across the trades; changing
lot size would change both wins and losses and is not the proposed repair.

## Flight verification and limits

All four raw Flight chains pass existing `verify_records`, including segment order,
sequence and SHA-256 linkage. They contain1986/384/427/236 records respectively.
This establishes retained chain integrity, not complete exchange/broker tick coverage.
The first two chains have no recorded GAP events; the losses have3 and5 respectively.
Their recorded summaries remain unchanged and correctly retain `chainVerified:false`:
that field describes the original summary export, not this later raw-chain audit.

The two loss summaries have zero recorded profitable seconds and negative best
modeled net marks (-46.24504 and-27.24105 broker pips). Their MFE fields are zero;
zero alone is not proof the true maximum was exactly zero. Existing native-TP audit
finds no proven TP crossing in130 and94 eligible observations respectively. Missing
intervals cannot prove no profitable instant existed. No earlier profitable close
or saved loss is established. The losses lasted78.436 and65.286seconds.

The winners have8 and4 sampled native-TP crossings respectively, followed by actual
closed outcomes. Crossings are observations, not extra fills or proof of execution
cause/delay. Actual fill-relative protection differs from planned structural prices;
never substitute the planned TP for an observed broker TP.

## Candidate comparison

| Candidate                           | What these records establish                                                                                                                                                                                                | Decision                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Shorter fixed TP0.4/0.6 price units | Neither losing sampled path establishes a profitable exit; gaps remain. Smaller TP would reduce available gross reward if reached.                                                                                          | Not supported as the repair for these losses.                             |
| Gross risk:reward1:1 or1:1.5        | Frozen diagnostics compute native-tick-rounded target geometry, retaining the same entry and structural stop. Net costs, future fills and post-original-close paths remain unknown.                                         | No executable return comparison or promotion.                             |
| Structural stop at most2x target    | On the four closed observations, it would reject both winning geometries and the first losing geometry, retaining the second losing geometry. This is admission classification, not a simulated portfolio or fitted filter. | Do not promote from a selected subset.                                    |
| 180-second holding exit             | Both losses ended before180seconds. Only the first winner lasted beyond that timer. No close execution or net benefit was observed at the timer.                                                                            | Not a demonstrated loss repair.                                           |
| Entry timing/range                  | Ten distinct orders ended unfilled; the four filled entries differ from planned prices by0.14/0.30/0.23/0.22 price units. These observations alone do not establish a better buffer or missed winners.                      | Continue existing finite entry/range allocations; preserve broker bounds. |

The next economic review needs the predeclared complete-cohort floor of20 closes
over5sessions, usable causal quote paths, actual costs and execution-aware candidate
comparison. That floor is not profitability qualification. Source drift, storage
faults and missing paths must remain explicit. No extra news/DOM purchase is justified
by this first review; the current blocker is reliable execution/outcome evidence.

## Persistent work and delivery

Protocol1.1 timer is already deployed and collects future windows without operator
prompts. It has no order/promotion authority and will not silently deploy a strategy.
Actual532 activation was verified at10:15UTC: qualification-source fingerprint
`c997d628e4cf37a5c2463f554f200f5b5ed26766f630ecaf9fba1a5fae28e95a`,
first future registration10:30UTC, both services successful, old529 registration
unchanged and trading source still39588e87. Three natural reports now confirm capture.
See [activation receipt](https://github.com/AegisFintech/scalping-bot/issues/532#issuecomment-6628230317).

This documentation-only review reuses the identical executable-source qualification:
2885tests/no skips, all gates and four configuration checks passed; final hook repair
also passed exact-head hosted CI inPR533. Formatting/secret scans and unchanged qualification-source fingerprint verification
pass; both independent reviews are clear. Required exact-head CI precedes merge. Economic settings remain unchanged; no runtime deployment
is needed for this report.
