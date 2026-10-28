# Offline research proposal scope policy

Issue [#410](https://github.com/AegisFintech/scalping-bot/issues/410) implements a pure, offline scope comparison for the future publisher in [#401](https://github.com/AegisFintech/scalping-bot/issues/401). It permits only narrowly named research source, new tests and new proposal notes. Existing tests and proposal notes are immutable. Exact changed paths, hashes, modes, sizes, base identity and tree identity must agree; protected paths, symlinks, module collisions and ambiguous paths fail closed.

The caller supplies both tree snapshots. They must come from a separately trusted verifier, not the model; this module does not verify Git objects or their origin. A successful result is `SCOPE_MATCH_ONLY`, with all execution, broker, publishing and merge authority false. It does not run candidate code, check dependency closure, attest a sandbox, access credentials, or perform network or Git operations. No publisher is enabled by this change.

Before any autonomous delivery, #401 still requires independently verified source and policy, an isolated unprivileged test worker, credential separation, durable recovery for unknown outcomes, and server-enforced exact-head checks and independent review. The currently unprotected main branch cannot establish those guarantees.

Qualification: `PYTHONDONTWRITEBYTECODE=1 /opt/scalper-node22/bin/node scripts/qualify.mjs` passed all checks, including 1,166 Node, 132 PostgreSQL and 664 Python tests. The [sanitized receipt](evidence/publisher-policy-validation.json) records the source and runtime fingerprints. Independent standards and specification reviews found no blocker for this offline scope.
