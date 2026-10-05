# ISSUE-262 — Retained forward evidence summary and recovery

Issue: https://github.com/AegisFintech/scalping-bot/issues/262.

The optional `strategy:forward-summary` command reads existing private envelopes;
it cannot collect new outcomes, contact a broker/provider, modify registration,
change a strategy or promote a candidate. Original #255 code, frozen registration,
reports and running timer are preserved in the original checkout. Dependency
updates in the separate upgrade worktree do not update the observer's source.

```sh
npm run strategy:forward-summary -- \
  --directory /PATH/TO/RETAINED_STUDY \
  --study-sha256 TRUSTED_REGISTRATION_DIGEST \
  --as-of FIXED_UTC_MILLISECOND_TIMESTAMP \
  --output /PRIVATE/PATH/NEW_SUMMARY.json
```

Use an explicit past/current UTC cutoff such as `2026-10-05T03:26:00.000Z`.
The output must be outside the study directory and must not already exist.
Publication uses a flushed private file and exclusive atomic link. The envelope
contains the canonical body checksum. Checksums detect corruption, not signatures
or independent attestation against deliberate replacement; retain the registration
anchor and report hashes in a separately trusted backup.

Verification binds to the trusted registration digest, original registered source
identity, exact consecutive window indices, cutoffs, observation/settlement times
and each daily checksum. It rejects missing middle windows, unexpected names,
symlinks, oversized files, future cutoffs, changed denominators, invented economics,
invalid actual cost totals and authority flags. At most 30 reports of 32 MB are
read sequentially. Due-but-unreported windows remain distinct from observed empty
windows. No missing day is assigned zero trades or healthy-broker status.

Every retained window stays in the summary, with all base/stress entry and TP
candidate status counts, open/pending/gap/ambiguous outcomes, exclusions and
complete/unresolved paired denominators. Entry and TP comparisons remain separate.
Gross complete-subset statistics retain their selection warnings and are not pooled
into a winning return. Counterfactual fees/swap/FX/margin, provider costs and net
expectancy remain unavailable. Actual close-time totals are separately labelled
recorded trades, not a dynamically resized portfolio or account return. Thirty
calendar days remains a collection batch, not strategy qualification.

Actual retained evidence as of October 5 **03:26 UTC**: **2 windows**; first has
12 closed trades, gross **-560.74**, signed costs **-252.36**, net **-813.10**;
second is a valid empty window. No due unreported window at that cutoff. The next
window is eligible at October 5 04:10 UTC. All outputs remain **HOLD**. Private
verified summary: `/tmp/scalper-forward-summary-262-actual.json`. An earlier
synthetic future-cutoff smoke is not an actual collection snapshot; the CLI now
explicitly refuses future cutoffs.

## Portable recovery

GitHub issues #257–#262 and their source PRs preserve the upgrade backlog, code and
reports if this server is lost. They do **not** back up financial journals, private
credentials, sampled tape or runtime study envelopes.

Retain an encrypted off-host copy of the original source commit and exact locks,
registration and all immutable day files, alongside the existing verified database,
chart and pinned/rolling market-evidence backup. Preserve ownership, 0700 study
directory/0600 files, timestamps, trusted registration digest and daily checksums.
Never publish individual rows, credentials or account identifiers to GitHub. This
change documents that requirement; it does not claim an off-host copy was made or
silently add private research to the existing backup manifest.

Restore into an isolated observer checkout with its original pinned source/runtime,
verify hashes and journal/storage restore procedures before re-enabling only the
research timer. Check all retained windows using this summary tool first. Resume
missing fixed windows with the original runner's one-window-per-invocation policy;
never edit/backdate a registration, overwrite a daily report or cherry-pick wins.
If original source or required tape cannot be restored, halt research and keep
missing evidence explicit. A new collection requires a separate future registration.
Restoring research grants no trading restart, order replay or accounting reset.

Validation: Python summary tests **10 passed**, schema test **1 passed**, Ruff and
mypy passed; retained actual envelopes verified without mutation. Full cross-batch
qualification follows in the final report. Rollback: stop using this optional
command and preserve its artifacts; original trading/research state is unchanged.
