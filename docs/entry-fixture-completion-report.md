# ISSUE-297 — Causal replacement fixture completion

Issue: https://github.com/AegisFintech/scalping-bot/issues/297.
Related roadmap review PR: #296. Test fixture only; production unchanged.

## Retained failure and cause

Hosted full qualification run 38334644623 failed one of 70 database tests: `entry-recovery.integration.test.ts:170`, replacement-child retirement expected true but returned false. All other 69 database tests passed; other completed gates, including audits, passed. A separate full hosted run on the same planning head passed; that does not erase the failed evidence.

The fixture already documents PostgreSQL provider availability at microsecond precision versus JavaScript millisecond evidence. It delayed observation after finishing the original context, but `finish(child.id)` had no such delay. Strict retirement correctly refuses evidence timestamped before provider availability. This is a fixture causal-order race, not evidence to weaken production timestamp checks.

Move the existing two-millisecond observation wait into the fixture's shared completion helper. Both original and replacement completions now use the same later-observation ordering; the concurrency, one-replacement/no-chaining and history-preservation assertions remain unchanged. Production source, SQL, contracts, broker behavior and frozen observer files are unchanged. CI failure evidence is retained locally under `/tmp/scalper-296-failure-evidence/qualification-failure-38334644623`.

## Verification and limits

The retained failing CI is the red evidence. The complete isolated qualification after the fixture change supplies green evidence; the full tests still include future/stale/missing/ownership/consumed/unknown-path rejection and concurrent restart claims. No new tests mirroring fixture implementation are added. A fixture delay is not authorization to delay or backdate production evidence, retry unknown commands or reset accounting. No runtime activation.

Full `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed on October 13: 848 Node tests / 70 isolated TLS PostgreSQL tests / 261 Python tests, no skips. Formatting, lint, TypeScript/Python types, isolated build, schema/migration/replay/fail-closed suites, secret scan and npm/pip audits passed. Exact wrapper results: `docs/evidence/entry-fixture-validation.json`; private logs `/tmp/scalper-qualification-TS4BgJ/checks`. Independent review found no issues. Staged diff/secret checks precede each commit; both hosted full qualifications must pass the actual pushed PR head before merge.
