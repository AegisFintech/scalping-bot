# Private learning console and live metadata receipt repair — ISSUE-491

The operator explicitly requested using existing Cloudflare Access without a
second `/learning` admin key. The HTML, login endpoint, session cookie and HMAC
code are removed. GET uses the existing bounded background reader. Writes still
require exact same-origin and the custom control header; typed bounds, audited
nonprivileged SSH receiver and separate private API-control credential remain.
The dashboard listener is127.0.0.1:8501, cloudflared is active, and the inspected
nginx configuration has no8501 upstream. Cloudflare Access policy is operator
managed; app code does not independently verify its policy. Keep this origin
private and recheck every future proxy change. Legacy admin-key material is unused
and retained privately only for rollback; it is never sent to browsers or logs.

## Live verification regression

#489's new metadata writer rejected the actual adapter's `Z` timestamp with
`METADATA_EVIDENCE_HASH`. Pydantic's existing `Instant` normalizes it to an ISO
`+00:00` string, but the producer had hashed the earlier spelling. Request and
response timestamps were already canonical; only populated adapter time exposed
the mismatch. The fix normalizes adapter time before hashing. Fixtures now cover
`Z`, fractional `Z`, explicitUTC and round-trip hash validation. A fresh actual
read-only session metadata response validates with no missing allowlisted terms.
This diagnostic makes no provider/order call and is not an acknowledgement fill.

During04:35Z rollout verification, metadata persistence failed. Existing trading
services and model worker kept their original PIDs; broker protection was separate.
The recorder was restored to its previous known source while the repair qualified.
Retain that failed interval as a capture limitation; do not backfill receipts.

## Hardened retirement boundary

The normal parent cycle wrote its immutable retirement receipt, then encountered
`EXDEV`: systemd's separate `ReadWritePaths` bind mounts prevent a rename between
the active queue and private authority even on one backing filesystem. A harmless
transient systemd test reproduced that exact namespace boundary. The original
queued envelope remains intact, and no attestation or dispatch was repeated.

The repaired flow writes an atomic private evidence copy, then atomically moves
the envelope inside the queue mount to Root's protected `retired` directory.
Interrupted receipt/copy completion reauthenticates the original queued bytes and
rechecks remote absence. Publisher ignores only that protected non-symlink reserved
directory; other unknown entries still reject. Both retained copies and the receipt
must match for completed retries. Old receipts and archived evidence are preserved.

## Prospective registration

Keep the original Root-owned #489 registration byte-identical. A separate #491
registration must freeze the repaired collector/model/recorder and policy hashes
before its future November3–10 UTC collection batch. Repoint only the read-only
collector to that separately registered source; old diagnostic windows remain
immutable. Future metadata and ACK receipt pairing is still observational, with
null broker source clock/counterfactual costs and no economic qualification.
Old frozen experimental registrations and all unknown provider/command claims
remain unchanged. Actual superseding registration/activation receipts go on #491.

## Validation

47 focused tests, strict typing of110 files, and browser checks pass. Browser
checks open without a local key and cover control forms, exact decimal budgets,
review/publisher blockers, text safety, mobile width and no page errors.
Both fresh independent Standards and Spec reviews have no P1/P2 findings.
Full qualification passes all2,614 tests (1,278 Node,147 PostgreSQL lifecycle,
1,189 Python), formatting/lint, TS/build, Python typing, schemas/migrations,
secrets and npm/pip audits. [Qualified-source receipt](evidence/completion491-qualification.json).
All four sample/deployed config checks pass. An earlier full run reached the
`/tmp`2GiB reserve; completed disposable builds/old test output and a clean merged
worktree were removed, with all reports/logs retained. The final full rerun passes.
Exact-source push/CI/review and deployed private-origin/real-receipt readbacks
complete delivery; future qualification is separate from software completion. No trading economic/risk policy changes.

## Verified activation

PR#492 merged and code sourcec8029f87321c18849d46cce67c9b05056ec1381c is
running, with qualified fingerprintde5b20dc94d37dbe87c4ac6a2cf93e19e2d394391b6d000bbd801449e65f86a6.
[Sanitized runtime receipt](evidence/completion491-activation.json),
[operational issue receipt](https://github.com/AegisFintech/scalping-bot/issues/491#issuecomment-6569620117).

Live browser opens without a local admin key, emits no JS errors, and rejects a
cross-origin control request403. Origin remains loopback with no nginx8501 route;
Cloudflare policy remains operator-managed. Main desk assets are byte-identical.
The full immutable release verifies after execution. All four core PIDs stayed
unchanged; recorder/collector/publisher/parent timers are active. Fresh actual
metadata validates, the old partial retirement receipt is preserved and its
private/same-mount envelope copies match;4,147 prior files remain unchanged.

The original registration is unchanged and repaired source was separately frozen
at05:10:20Z November2 before the November3–10 UTC batch. Hour04:00–05:00 retained
zero ACK rows, which does not prove no fills or a flat account. A future genuine
ACK/metadata association remains #407. Publisher MERGED is historical PR#461,
not the natural holding cycle proof in #466. Generation waits on duplicate data;
its retained reason still describes the completed retirement. No paid generation
was forced. Independent economic qualification remains #403.
