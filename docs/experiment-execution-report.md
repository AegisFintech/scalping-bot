# Distributed fixed-method experiments — ISSUE-450

[#450](https://github.com/AegisFintech/scalping-bot/issues/450) connects the frozen
registry to a separately confined tc02 worker. Implementation is complete and qualification is in progress; this document does not yet claim activation.

The initial method measures costs and causal entry-acceptance clocks across a
complete bounded observation packet. It is a retrospective diagnostic prerequisite,
not a strategy optimization or an answer to arbitrary advisor prose. The originating
question stays explicitly unanswered. Positive means only the stated packet-level
joint claim passed: positive window-closed net and no missing acceptance clocks.
Zero closes is inconclusive. All roles, WAITs, rejections, missing clocks, nonfills,
open/partial setups, signed fees and coverage warnings remain in the result.
Recorded net already includes fees. Currency is restricted to USD. Neither worker
output nor a validated arithmetic result grants economic or publishing authority.

## Trust and execution

The coordinator reuses the protected Git-object reader from #448 to verify a
reviewed fixed module against a provisioned commit. Root-owned source/runtime and
verifier pins are not supplied by the request. The existing #449 registry freezes
input, method and code before dispatch. No generated module is admitted in this
stage; #451 must qualify that separate capability.

A dedicated SSH key reaches a server-side forced-command receiver. The receiver
accepts only bounded submit/query JSON, validates the registration and pinned
method, and durably retains immutable intake. It cannot execute a requested shell
command. The separately constrained worker runs one queued job per service tick.
It claims execution durably before launching #421's sandbox, now with an optional
8MiB exact-digest, read-only `/input.json` mount. The old no-input call and frozen
#421 probe remain unchanged. Credentials, host archive, Git and network are absent
inside the experiment. Outer cgroup and existing namespace/time/output limits apply.

The tc01 claim permits one submit attempt. Lost SSH replies, timeouts, restart or
an absent remote receipt cause queries of the same trial, never resubmission.
The tc02 execution claim also survives process death; unresolved execution is
reported as RUNNING_OR_UNKNOWN and never replayed. A bounded rotating query cursor
prevents unknown jobs starving subsequent work. Conflicting receipts reject.
Both machines retain original failures, claims and immutable result bytes.

A separate trusted typed-data implementation recomputes the complete measurement
outside the worker. Exact equality and registration/input/code/runtime/verifier/
source/claim/time binding precede an attributable experiment finding and closure.
The untrusted registry outcome remains marked unverified; the separate finding
states whether this fixed measurement was verified. Rejected or failed work closes
with its real failure class, never a successful economic finding. Finding-before-
closure interruption recovers from the retained receipt without rerunning work.

## Operations and remaining work

Provisioning, actual remote containment/reconciliation evidence and activation
receipt will be recorded after qualification. Existing observation review and demo
execution are independent; no broker restart, strategy/risk change or migration.
Disable experiment timers to roll back, retaining mailbox and registry records.
Do not restart the retired paper/root advisor or erase unknown jobs.

Generated experiment design, independent candidate attestation, publication,
qualified economic rollout and whole-harness unattended qualification remain
#451/#452/#403/#431. This stage does not complete the full self-improvement loop.

## Review and qualification

Independent Standards and Spec review found and corrected intake/worker lock
contention, admission failure preventing reconciliation, discarded safe failure
codes, invalid provider-clock attribution, and newest-job preference starving an
older pending job.111 registry/execution/worker tests pass, including eight-job
rotation, partial/open rows, signed costs and restart/unknown outcomes.

The real tc02 [data-mount probe](evidence/experiment-data-probe.json) passed under
the dedicated unprivileged identity and constrained systemd unit. It verified
read-only input/source/verifier, absence of host files and network, descendant
timeout cleanup and a successful subsequent run. The new runtime is separately
pinned; the frozen #421 runtime was preserved. Full qualification, remote lifecycle
and periodic activation receipts follow. Both sample/active policy/startup checks
pass. Earlier qualification attempts were stopped for review corrections; their
isolated databases stopped and they are not passing receipts.
