# ISSUE-382 — Codex thread-history file cap

Operator authorized increasing the dedicated analysis worker's per-file ceiling
after exact diagnosis. This is an operational resource fix for the ONE existing
demo, not a new strategy/prompt/application release. Application/worker remain
0.7.2-quick-oco.1-codex.1, artifact main898083c and source760f43afc089368ef29e7671f0e8bdacfa523cb4a7ca27c3a59cab342c327f9c.
Operational configuration comes from the new reviewed main commit; report these
component sources separately. Do not edit the immutable application artifact.

## Reproduction

The systemd worker inherited LimitFSIZE33554432 bytes (32MiB). Codex's persistent
thread_history_1.sqlite grew beyond it. A natural retry killed the app-server child
withSIGXFSZ and produced generic AI_ANALYSIS_FAILED/Ready-wait. A no-inference probe
under the same limit showed pwrite64 of4096 bytes at offset33554432 returning
EFBIG on that SQLite file, then SIGXFSZ/CODEX_PROTOCOL_EOF_UNKNOWN. Standalone probes
with a higher file limit worked. The sign-in and ordinary usage were allowed;
19% weekly usage was not exhaustion. Earlier429 errors were a separate observation.
Exact sanitized investigation: https://github.com/AegisFintech/scalping-bot/issues/382#issuecomment-6431695696.

## Change and constraints

Set only the dedicated worker's finite file cap to512MiB (536870912 bytes) in the
repository service template and a scoped systemd deployment override. This cap is
not preallocated disk or a model context/token limit. Keep memory512MiB, swap0,
process64, CPU/isolation, credential access and every other setting unchanged.
No prompt/input/window/compaction/token/billing policy, TP0.40/SL7.00, dynamic
sizing, broker state, cooldown or provider dispatch history is changed.

Preserve Codex's entire existing SQLite/session/claim state. No truncation, deletion,
new parallel state database, unknown turn replay or speculative fresh provider call.
Prefer raising the idle running worker's inherited limit with prlimit and persisting
the same systemd override; if not permitted, restart only after no REQUESTING
context or active Codex child is verified. Normal broker/session/freshness/account/
reconciliation/risk/cooldown gates own the next analysis and all order authority.

The application and isolated worker code remain the existing verified artifacts;
no application/market/execution/dashboard restart or new research cohort is needed
for a scoped OS resource adjustment. Existing frozen source/registrations stay
unchanged. Operational receipt identifies exact config main/PR and live effective
soft/hard limits separately from the application source. Future aggregate storage
monitoring and specific failure display are follow-up work, not permission to
prune canonical trading or frozen research evidence.

## Validation and rollback

Regression derives the cap from the actual unit, reproduces EFBIG at the old32MiB
boundary, succeeds at that same offset under512MiB with a sparse file, and verifies
the original history prefix remains. Separate guard checks retain memory/tasks/
swap/isolation. No512MiB allocation is needed. Run the full repository qualification,
secret/dependency scans and AST Graphify before merge, plus systemd unit validation,
effective live limit and a normal next provider response. A result/WAIT is not a
broker fill or proof of profitability. Preserve unavailable/unknown outcomes.

Rollback is a documented forward resource correction; do not restore32MiB while
any required state file exceeds it. Restore a reviewed finite cap only once all
active work is settled and preserved state fits; never shrink/reset history to
force a rollback. Resource growth is distinct from recurring diagnostic log
rotation. No credentials or account identifiers belong in reports.

## Qualified operational checkpoint

The approved512MiB soft/hard limit and scoped persistent override are effective
without any worker/application restart. Existing SQLite inode/state and private
configuration were retained; memory/tasks/swap limits remain unchanged. No provider
or broker command was forced. Full Node22 `node scripts/qualify.mjs` passed1,119
Node +124 PostgreSQL +459 Python tests (1,702 total), every required formatting/
lint/types/build/schema/migration/replay/fail-closed/security/dependency gate.
Systemd validation and AST Graphify passed.
[Exact results](evidence/codex-file-cap-validation.json). The next normal provider
result and reviewed config main/PR receipt will be posted on #382; the application
and worker remain the existing matching immutable artifacts.

Normal scheduled retry2026-10-27T01:59:06.839061Z succeeded at01:59:13.601123Z
with a genuine Codex WAIT. This confirms analysis recovery, not a trade/fill or
profit claim. No provider/market/risk gate was bypassed.
