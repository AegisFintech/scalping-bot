# Trusted local Git source verification

[#448](https://github.com/AegisFintech/scalping-bot/issues/448), prerequisite for
#401/#402. Implements the first task in [the delivery queue](autonomous-harness-delivery-plan.md).

`source_verifier.verify` receives a validated scope proposal, a candidate tree ID,
and independent mirror/runtime/base pins. It reads complete base and candidate
Git trees, validates each Git object's identity/framing/type, computes SHA-256 for
actual file bytes, runs the existing scope policy and returns only the exact changed
files plus the bundle digest accepted by the isolated worker. Files are never checked
out, imported or executed. The return value grants no testing, dependency-closure,
publication, merge, broker or remote-freshness authority.

The mirror and its ancestors must be canonical root-owned non-writable paths; its
contents must be regular root-owned files/directories. Symlinks, alternates, grafts
and replacement references are refused. Git and prlimit binaries are independently
pinned. Reads use cleared environment, no global/system configuration, disabled
replacement interpretation, hooks/fsmonitor/credential helpers, denied protocols
and disabled lazy fetch. Git's local repository configuration is part of the
independently provisioned mirror trust boundary; it is not accepted from the model.
No origin URL is treated as authentication. The trusted provisioner must verify
remote provenance and refresh the pinned main commit independently.

Only the existing SHA-1 Git object format is supported; actual artifact contents
are additionally SHA-256-bound. Git's documented raw batch interface supplies object
type, length and bytes; filter/textconv modes are never requested. References:
[git-cat-file](https://git-scm.com/docs/git-cat-file) and
[Git configuration/environment](https://git-scm.com/docs/git).

Bounds:8MiB per object,64MiB total unique object bytes,20,000 tree entries/objects,
32 directory levels,100,000 mirror filesystem entries and60 seconds for Git reads.
Each Git process additionally has a bounded output file,512MiB address space,
10 CPU seconds and at most10 seconds wall time. Exact expected `refs/heads/main`
is checked before and after reads. This is local compare-and-check, not an atomic
remote publish operation or freshness guarantee; the future publisher must recheck
its base at publication. The operating system, pinned executables/system libraries,
root provisioner and immutable source coordinator remain trusted.

Object tests using temporary CI-owned mirrors explicitly substitute the trust
preflight; dedicated failure tests separately cover trust preconditions. Actual Git object reads, hashing, complete-tree comparison, hostile
environment and bounds are exercised. A separate real-host unprivileged probe is
required to establish the root-owned mirror boundary. Validation and probe receipts
follow below. This library does not install an autonomous publisher or modify trading.

## Real protected-mirror probe

The final source and checked-in `tests/fixtures/source-verifier-probe.py` ran on tc01
as `scalper-learning`, with a cleared environment and root-owned mirror/config/source
under `/opt/scalper-source-probe448`. It verified a copy of actual main plus one inert
research file whose contents would raise immediately if executed. Exact bytes/bundle
were accepted without execution; a false content hash was refused. The [receipt](evidence/source-verifier-probe.json)
binds source, probe, Git/launcher and object IDs. No service/timer or trading artifact
was changed. The mirror is a frozen qualification artifact, not a continuously updated
remote cache or activated publisher. Root ownership in this probe was not substituted.

Receipts are descriptive, not signed portable attestations. Downstream code must invoke
the independently controlled verifier or authenticate its provenance; a model-provided
JSON receipt is never authority. Runtime/library provenance and remote freshness remain
the provisioner's responsibility. Independent Standards and Spec reviews pass after
fixing common-directory/config redirection, packed replacements, directory-only scope
and invalid/control-character tree entries. All59 focused source/policy tests pass.

## Qualification

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed every required check:
1,271 Node,147 PostgreSQL and762 Python tests (2,180 total), formatting, lint/types,
build, schema/replay/lifecycle coverage, secrets and both dependency audits. Sample
and active-file policy/startup checks also pass. [Exact commands/results](evidence/source-verifier-validation.json).
Graphify AST updated, with the existing pyproject zero-node warning. Two regression
fixtures initially had an extra NUL in constructed tree records; corrected fixtures
now reach and verify the rejection paths. This code is a qualified library and probe,
not a running autonomous experiment or publisher; the remaining queue stays open.
