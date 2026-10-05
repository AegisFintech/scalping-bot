# ISSUE-260 — Exclusive versioned release preparation

Issue: <https://github.com/AegisFintech/scalping-bot/issues/260>.
Depends on [batch 259](upgrade-batch-259-report.md).

`npm run qualify` now binds its report to the code/configuration/prompt/lockfile
fingerprint and exact Node/Python interpreter bytes. Report-only documentation
changes do not change this code fingerprint. A database-only run is explicitly
unqualified. Every required formatting, lint/type/build, test, security and
isolated database check must have exactly one successful result.

`release:prepare` requires a clean checkout, a complete matching qualification
report and Node 22. It exclusively creates a new directory outside the checkout,
copies tracked assets plus the isolated installed npm/Python environments, and
builds there. It does not replace active dist, invoke PM2/systemd, switch a symlink,
restart services, enable live or execute broker commands. A failed/incomplete
build lacks a valid manifest and must not be launched or substituted for another
release. Existing directories are never overwritten or automatically removed.

The manifest binds commit, qualified source fingerprint, interpreter bytes and
all bundled files/symlink targets. Verification rejects changed/missing/extra
assets, external links except bound venv interpreter binaries, unqualified reports
and runtime drift. Protect the resulting release directory against writes after
verification; retain its matching private qualification logs separately.

Prepare from a clean qualified checkout (absolute new destination):

```sh
npm run qualify
npm run release:prepare -- /opt/ctrader-ai-scalper/releases/NEW_RELEASE /tmp/scalper-qualification-NEW/checks/results.json /var/lib/ctrader-ai-scalper
npm run release:verify -- /opt/ctrader-ai-scalper/releases/NEW_RELEASE
```

The supplied state root must already contain .runtime and logs directories. Their
explicit symlink targets are bound by the manifest; mutable state is excluded
from asset hashing. Use the pinned Node 22 binary for all three commands. This prepares source/runtime
artifacts, not authorization to start trading. Before any rollout, review a
release-specific supervisor configuration with exact paths, stable state/log/chart
locations and protected external environment. The optional
ecosystem.release.config.cjs requires absolute SCALPER_RELEASE_DIR,
SCALPER_NODE_BINARY and SCALPER_ENV_FILE (0600); it verifies the bundle before
returning any PM2 process definitions. It never selects a mutable current symlink
or defaults to the host Node. Python services must use the bundled
interpreter with `-m uvicorn` / `-m streamlit` rather than copied scripts' original
venv shebangs. Existing runtime state and credentials must remain external; copying
.env or linking arbitrary old code into a release is not supported.

Rollback selects a previously verified release only after broker/session/state
reconciliation. It never restores an old accounting database, resets losses,
replays unknown commands or edits the active frozen observer. Existing services
were not reconfigured in this implementation. Supervisor activation and its
failure drills remain an operational rollout milestone on the GitHub issue.

Five focused tests pass and cover failed/missing checks, source/runtime mismatch,
modified/added/missing assets, outside/state links, schema and refused incomplete
release/supervisor configuration. TypeScript and changed-test lint pass. Final full qualification is recorded in batch 262's
report. These manifests provide deterministic integrity checks, not cryptographic
third-party attestation or protection against a privileged operator forging both
bundle and report.

Final combined validation and remote delivery: [upgrade delivery report](upgrade-delivery-report.md).

Real bundle preparation found Node cp rewriting relative installed-package links; the release follow-up preserves verbatim links. Six focused release/schema tests and the actual exclusive bundle/supervisor verification now pass. No service was started.
