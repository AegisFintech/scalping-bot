# Audited historical pre-dispatch recovery — #434 / #427

The existing demo is blocked by an October 28 intent rejected locally before
broker dispatch. The GTD gateway defect was corrected and deployed in #428/#436.
This change provides a root-only, exact-incident recovery, not a general unlock.
No recovery has been applied by this implementation checkpoint.

## Evidence and authority

The immutable activation receipt pins release `aebb1deec26509402a6250464d45be0350068fe7`
and its qualified source. The separately captured October 29 incident receipt
records the same gateway artifact, execution start before the incident, zero
supervisor restarts, and exact intent/rejection chronology. Both sanitized
receipts are hashed and fixture-tested; private originals remain root-owned 0600.
The CLI verifies the original release manifest and complete artifact before acting.
The original code rejects GTD at validation before the first broker submission.
The SQL check matches the exact microsecond intent, rejection and group timestamps,
command type/side, volume, prices, expiry and submission deadline. Existing audit,
provider, broker and accounting records remain unchanged.

This is trusted administrator deployment/audit evidence, not cryptographic
in-memory attestation. It relies on the original trusted activation and incident
capture, uncompromised local administrator/storage, and an exclusive bot executor.
Empty broker history, missing local timestamps or current files alone are not
non-dispatch proof. If the receipts, source, chronology or exclusive operation are
contradicted, retain the lock. Never manufacture retrospective evidence.

A fresh independent demo connection has `allowOrderCommands:false` and cannot
refresh its token. The account is bound to a prior mapped strategy-owned order
using broker/client IDs, label, side, volume and symbol, with complete broker
history. Account aliases alone cannot establish that binding. The incident window
covers the entire account from five minutes before intent through observation;
paginated history, any orders/deals or open exposure blocks recovery. No identifiers
or raw broker payloads are printed or committed. Present malformed repeated fields
now reject instead of becoming an empty history; omitted/null repeated fields
retain their existing unset semantics.

## Procedure and state transition

Only after independent review, full qualification and merged delivery:

1. Verify the qualified release and current deployment, original receipts, fresh
   complete broker history, no exposure/in-flight inference and exact existing lock.
2. Apply additive migration 0038 with the local database administrator. Verify all
   previous checksums and retain accounting/history invariants. Never grant DDL to
   the app or observer. Grant only necessary evidence-table access.
3. Acquire an authenticated durable pause with a unique `codex-predispatch-…`
   owner; preserve a pre-existing operator pause. Stop the sole execution process.
   The CLI independently requires one stopped PM2 entry and no execution process.
4. Run `scripts/recover-predispatch-incident.ts --pause-actor <owned-actor>` from
   the reviewed artifact with the existing protected deployment environment.
   It accepts neither target IDs nor caller-supplied broker assertions.
5. A SERIALIZABLE transaction locks the scope, group, order and owned pause;
   checks exact durable records and historical account anchor; independently reads
   complete broker evidence twice; requires both observations within 15 seconds;
   and rechecks process/pause. Insert the immutable proof and transition only:

   ```text
   order: CANCEL_PENDING -> REJECTED
   group: RECONCILIATION_REQUIRED -> FAILED / LOCAL_PRE_DISPATCH_REJECTION
   ```

   No broker cancellation/event, trade, fill, accounting update, command replay or
   immediate-refresh exception is created. Original intent/rejection remains.

6. Independently verify the proof and exact terminal states. Start the matching
   reviewed services, verify fresh reconciliation, unchanged risk/account history,
   worker/Flight compatibility and removal of the incident-specific blocker. Only
   then release the owned pause and observe normal scheduling without forcing it.

Broker reads and PostgreSQL are not atomic. Stopping the only executor, holding
its durable pause and double observation prevent ordinary bot races; manual or
external broker activity after the observation cannot be ruled out. Normal startup
reconciliation remains mandatory before new risk. Unknown/manual activity must
block, never be cancelled by this tool.

## Failure and rollback

Before commit, any stale/ambiguous/changed/missing evidence or failed write rolls
back proof and state together. No automatic retry. A lost COMMIT response is
`PREDISPATCH_COMMIT_OUTCOME_UNKNOWN`; cleanup failure after success is
`PREDISPATCH_COMMITTED_CLEANUP_UNVERIFIED`. Keep the pause and inspect proof/state
read-only before any decision; never rerun based on the exit code alone.

Migration 0038 is additive and does not transition data itself. Retain it and its
immutable proof permanently; UPDATE/DELETE/TRUNCATE are rejected. Verify app/reader lack those privileges. Disable the one-off CLI
rather than dropping evidence. After a successful recovery, do not restore the
old active-group state or downgrade the database, especially once subsequent
activity exists. On a failed precommit recovery, restart the previously qualified
execution with its original unresolved state and verify before restoring only the
owned pause. Existing economic policy, risk locks and history are never reset.

## Validation and delivery

Focused unit/schema/migration checks: 79 passing. Isolated TLS PostgreSQL recovery
checks: 14 passing, including changed second observation, invalid account anchor,
missing pause, changed process, receipt tampering, immutable proof, partial-write
rollback, delayed verification/write freshness, contradictory intent identity and
real commit with lost reply. The first full run passed formatting but found an unnecessary async test mock;
it was corrected without runtime changes. Full qualification and independent
review are pending. A prior negative production preflight refused recovery while
execution was running; the final reviewed CLI must repeat that guard check.

Changed surfaces: internal proof/store/account-binding modules; administrative
CLI; additive evidence migration/schema; broker repeated-field parser and its
callers' regression tests; migration inventories; fixtures, reports and lean
agent instructions. No new dependency, strategy, env setting, HTTP control or
background unlock service. Detailed agent rules were retained with links;
existing immutable release/receipt files are required dependencies, not clutter.
