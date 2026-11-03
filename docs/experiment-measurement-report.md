# Experiment cost and idle evidence — ISSUE-517

This batch instruments the existing policy without changing it. The finite demo
catalogue and recurring controller remain #518/#519/#520; parent #515 stays open.

Cost rejection now retains decimal target/stop distances, minimum-volume broker
commission, conversion,65-tick reserve, modeled net outcomes, required target,
shortfall and the implied modeled break-even win fraction when both outcomes
are positive. The same existing fee/FX/minimum-commission arithmetic owns admission;
no rescue, widening, extra spread deduction or risk change is introduced. Actual
exit cost remains null. Valid current examples and historical rejection remain.
Existing exact signed-deal reconciliation is in `docs/loss496-review.md`; current
0.9 has no closes to calibrate actual exits. Old0.8 outcomes cannot qualify0.9.

The existing market-data quote callback additionally feeds a bounded observer.
It records the original normalized bid/ask update, independent side source/receive
clocks, reconnect invalidation and stream/sequence. It sends no broker requests
and does not await disk. Existing DOM/snapshot recording and Flight stay intact.
A serialized bounded queue caps2048 updates. Gzip segments close every five minutes
of observed updates or1MiB uncompressed; verified compressed/raw hashes and a
manifest bind their bytes. Source comes from process CODE_VERSION, explicitly not
independently attested by this recorder; deployment must verify its release manifest.
An idle market without updates may leave a partial in-memory segment until the
next update or graceful shutdown. A crash can lose that tail; absence is not flat.

Storage uses256MiB at most and preserves a2GiB free-space reserve. It never evicts
or overwrites completed evidence. Capacity or I/O faults stop this observer only;
health exposes drops/errors and the broker executor continues its existing gates.
No remote archive is claimed. Transport/archival capacity must be proven before
allowing deletion; manifests explicitly state remoteArchiveVerified=false.

Versioned JSON schemas cover actual serialized updates/manifests and cost evidence.
Tests exercise side-specific clocks, reconnect, compression/hash verification,
rotation, backlog drops, capacity failure with old evidence retained, and actual
numeric rejection fields. Full qualification and independent review precede rollout.
Actual recorder health/storage and original frozen-study preservation must be
verified after the final matched rollout; source completion is not activation.

Independent review corrections: callback side state is now snapshotted before
bounded queue admission, so even a dropped reconnect invalidates later provenance.
Orphan temporary bytes count against capacity. Final-flush faults latch sanitized
health and emit a safe shutdown event. Actual-volume command failures retain the
same numeric diagnostics as minimum-volume checks, nested under cost_admission
to preserve a strict schema independently from legacy journal fields. The target threshold now
reevaluates price-dependent commission with bounded bisection; when no threshold
is verified within the policy ceiling, it stays null. New regressions cover these
cases. Initial mock typing/lint/import failures were corrected before qualification.

Full `PYTHONDONTWRITEBYTECODE=1 node scripts/qualify.mjs` passes:1,300 Node +157
DB +1,282 Python =2,739 tests, every required format/lint/type/build/schema/replay/
migration/fail-closed/lifecycle/secret/audit gate. Both review axes are clear after
corrections. [Exact receipt](evidence/experiment-measurement-validation.json).
Hosted exact-head checks and matched activation remain required. Recorder health,
retained original bytes and frozen-study preservation are rollout acceptance,
not replaced by this source receipt. Issue517 stays open until that proof.
