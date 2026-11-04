# Position-state clocks and R:R diagnostics — ISSUE-532

The operator permits reviewed demo R:R experiments within unchanged5% shared/2.5%
single-leg ceilings. This batch prepares gross risk:reward1:1 and1:1.5 hypotheses;
it does not activate new orders, stops, targets, sizing or market-close authority.

The actual07:00–07:30UTC packet demonstrated two different clocks: position close
at07:22:04.829 and its close-deal persistence at07:22:06.420719. The final native
protection observation was07:22:04.671. Requiring that old protection observation
to follow the closed ledger rejects a reconciled closed outcome. Position updated_at
is lifecycle/event time, not proof of when the row became known. The new method
compares it to fill/close occurrence, while independently retaining ALL original
receipt/persistence cutoff, broker resolution, identity, volume and signed-cost checks.

`position-clock-evidence-1.0` wraps the unchanged legacy packet with exact-packet-bound
position updated_at values selected inside the SAME repeatable-read transaction.
It never relabels native SL/TP observation time. Missing, duplicate, wrong-packet,
after-snapshot and incomplete scope clocks reject. Post-cutoff clocks/outcomes still
censor. Legacy reconstruction defaults and packet schemas remain unchanged. The
actual probe changes four zero-fill/two unknown to four zero-fill/one closed/one
unknown; the post-cutoff outcome remains unknown. This is a compatibility probe,
not prospective performance or proof that an earlier exit would have won.

`loss-control-screen-1.1` retains every input context/setup and adds two gross target
geometry rows per context. Stops and entry remain fixed; targets round inward at
native tick precision. WAIT/failure/unavailable rows remain. There is no fill,
queue, cost, margin or profit simulation, no admission or execution authority, and
net R:R remains null. Larger gross targets may take longer or never fill; this is
not a recommendation to mechanically widen current TP. Cost-aware executable
R:R changes still need a separately versioned finite DEMO protocol and independent review.

The existing collector supports a separately frozen1.1 future registration. Its
self-contained envelope is read from position-clocks.json; the original current.json
feed remains available for existing workers. Old529 registration, code artifact and
results remain untouched; its original timer continues. The new read-only timer has
no network or database credentials and changes no trading process. An envelope is
atomic and independently bound, so readers do not combine two mismatched files.

First actual529 window08:30–09:00UTC retained16WAIT,1failed(stale input),2geometry
rejections and1unavailable context; two zero-fill terminal setups, no closed outcome.
The decision journal includes17local WAIT checks and8BUY_ENTRY_TOO_CLOSE checks;
these are decisions, not broker rejections or paid provider calls. All denominators
and costs remain explicit; do not infer missed winners from later movement.

Validation and actual rollout receipts follow on issue532. Read-only source activation
is distinct from economic activation. Rollback only the new feed artifact/timer;
preserve both frozen studies, envelopes and reports. No historical accounting resets.

Validation notes: the first final rerun reached the formatter timeout without a
formatting diagnostic; a standalone formatter rerun passed. All four sample/deployed
policy/startup configuration checks passed. Independent standards and specification
reviews found no remaining issues, including the requested-versus-rounded gross R:R
distinction and actual PostgreSQL concurrent-update boundary test. Final full-suite
receipt: [qualification](evidence/position-clock-rr-validation.json).

Final `npm run qualify`: PASS,2,885 tests/no skips (1,321 Node,165 PostgreSQL,
1,399 Python), including the actual concurrent-update boundary. One existing
Starlette test-client warning remains. All format/lint/types/build/schema/migration/
replay/failure gates, secret scans and dependency audits pass. Source fingerprint:
`b736f3c9b507feb9ff2f1f53b00300f2c2e874fba1ea0f75671ed03267a45089`.
