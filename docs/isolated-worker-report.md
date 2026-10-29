# Isolated candidate process worker

Issue [421](https://github.com/AegisFintech/scalping-bot/issues/421), prerequisite
for the trusted publisher in [401](https://github.com/AegisFintech/scalping-bot/issues/401).
This is a library boundary, not an activated autonomous agent or publisher.

## Scope and trust

`python.research.isolated_worker.run` accepts bounded research files, an independently
approved bundle digest and a trusted runtime/verifier descriptor. It reuses the
existing publisher path and byte limits. It rejects root invocation, changed
bundles, unsafe runtime files/ancestors, changed runtime/verifier/launcher hashes
and missing aggregate resource limits before executing candidate code.

The trusted coordinator must supply approvals independently of the model and
provision root-owned runtime/verifier files in a non-writable ancestor chain.
The runtime is a minimal standalone standard-library Python filesystem; every
file, directory and mode is hashed. Symlinks and special files reject. It includes
empty `/proc`, `/dev`, `/tmp`, `/work` and `/verify.py` mount destinations.
The initial runtime does not contain project credentials, third-party Python
packages, a database, Git or a publisher. A later dependency change needs its own
reviewed runtime digest; the worker never installs requested dependencies.

The verifier is trusted code outside the candidate bundle. The existing offline
scope policy is not a Git verifier: #401 must still bind independently verified
base/candidate trees, dependency policy, exact tested bytes and review receipts.
Neither the model nor this worker grants itself publication/merge authority.

## Isolation and limits

The outer service uses a dedicated non-login user, a private temporary directory,
512MiB total memory, zero swap,32 tasks and50% CPU. The worker reads its cgroup-v2
limits before execution. Per-process address-space/CPU/file/process limits alone
cannot bound descendant memory or tmpfs, so they are additional controls only.

Bubblewrap requires fresh user, PID, network, IPC, UTS, cgroup and mount namespaces, drops all
capabilities, clears the environment, exposes only the pinned runtime and read-only
candidate/verifier mounts, and uses an isolated temporary filesystem. Python uses
isolated mode with site initialization and bytecode writes disabled. Inherited
file descriptors and stdin are closed. No shell or alternate executor is a fallback.

Resource limits are30 seconds wall time,15 seconds per-process CPU,512MiB per-process
address space,32 processes,64 descriptors,1MiB per file and64KiB combined output.
The outer cgroup bounds all descendants. Timeout/output failure kills the launcher;
parent-death and PID-namespace lifecycle terminate its sandbox. The supervisor
must additionally retain systemd's control-group kill mode and runtime deadline.

Output is untrusted bytes. A zero exit may be a candidate lying or a weak test;
it is not a test verdict, economic qualification, broker or publication authority.
The kernel, root-owned launcher/runtime and independent coordinator remain trusted.
This is process isolation, not a virtual machine or protection from a kernel flaw.

## Real qualification

The checked-in `tests/fixtures/isolated-worker-probe.py` runs against a separately
provisioned root-owned runtime and `trust.json`, from a credential-free account.
The fixture asserts host filesystem, credential/environment, runtime/verifier
write and network denial, plus memory/file/process/output/time limits. A timed-out
forked descendant was observed with five host processes, and the cgroup returned
to only the coordinator after every case before reuse. The final-source
[tc02 receipt](evidence/isolated-worker-probe.json) binds the tested worker, runtime
and verifier hashes. It emits only a
bounded result and hashes. Unit tests separately exercise invalid input, trust
tampering, absent sandbox, unsafe/missing aggregate limits and collection failures.

An initial local `DynamicUser=yes` probe refused before running candidate code:
Bubblewrap reported `Function not implemented` when opening its source mount.
No unsandboxed fallback ran. The exact kernel/filter cause was not established.
The fixed non-login account service profile passed. An independent real tc02
probe then passed using its own architecture-specific runtime; source and pinned
verifier matched. No tc01 agent, tc02 broker adapter or main trading service was
started or restarted. Only public source/fixtures crossed hosts.

The research-machine invocation uses the existing interpreter to run the trusted
wrapper, then the isolated runtime interpreter for candidate code:

```sh
systemd-run --wait --pipe --collect \
  --property=User=scalper-research-test \
  --property=MemoryMax=512M --property=MemorySwapMax=0 \
  --property=TasksMax=32 --property=CPUQuota=50% \
  --property=RuntimeMaxSec=120 --property=ProtectHome=yes \
  --property=ProtectSystem=strict --property=PrivateTmp=yes \
  --property=NoNewPrivileges=yes \
  /opt/xauusd/.venv/bin/python /opt/scalper-isolation-probe421/probe.py
```

The installed source under `/opt/scalper-isolation-probe421` is a qualification
artifact only. There is no timer, service enablement, queue, Codex request or
automatic integration into existing research jobs. Preserve the receipt and
root-owned runtime; removal requires no trading or accounting transition.

Independent Standards and Spec review found a relative-runtime path mismatch;
canonical absolute paths and four no-process-start regressions fixed it. Review
also replaced best-effort namespace flags with explicit mandatory flags and added
the descendant-cleanup probe. Final staged review also added explicit rejection of
unreadable runtime subtrees and non-directory runtimes; an incomplete scan cannot
attest a runtime. Both reviews found no remaining blocker.33 focused
worker tests pass. Earlier qualification attempts were stopped for the reviewed
changes and lint correction, with their isolated databases shut down; they are
not passing receipts. Fresh `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`
passed every gate:1,271 Node/schema/migration,147 PostgreSQL and703 Python tests
(2,121 total), formatting/lint/types/build, secret scan and both dependency audits.
The existing Starlette/httpx deprecation warning remains. Exact commands/results:
[qualification receipt](evidence/isolated-worker-validation.json).

The [next integration review](research-integration-next-slice.md) identifies the
remaining root advisor launcher, hardcoded paper/deployment capabilities and
frozen-dataset-only plan contracts. The candidate worker does not fix those
separate boundaries; permissions are not the missing dependency. Both sample and active PM2-selected file policy/startup configuration checks pass.
The main demo's execution and economic policy are unchanged.
