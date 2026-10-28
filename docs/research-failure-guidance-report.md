# Research failure guidance activation

The tc01 research harness incorrectly advised recording a finding for a failed
tool result. [xauusd PR 28](https://github.com/AegisFintech/xauusd/pull/28)
separates successful results awaiting findings from failed or unknown results.
Failures are inspected without inventing findings or replaying unknown work.

The merged revision `d1bb18b2907e331f89cf80d8c90a769460da0602` is active on
tc01. The agent and read-only view are active, and the view exposes the new
guidance. The persistent thread and pre-existing dirty files were preserved;
no provider call or broker command was forced.

Qualification on tc01 passed 993 tests with one optional database parity test
skipped. Independent specification and standards reviews passed. The tested
source and deployed source were compared using a 242-file manifest. Qualification
details are also recorded in the upstream PR.

Two initial deployment attempts were rolled back. One mishandled leading spaces
in Git status and required repair of rollout-only index entries; the other used
the wrong working directory for a relative SQLite path and created a separate
empty database, which was verified and removed. The corrected rollback was
tested with a dirty worktree before successful activation.

This is a research-only change. A genuine fresh autonomous result, finding and
plan close remains unverified under [issue 405](https://github.com/AegisFintech/scalping-bot/issues/405).
Passing tests does not establish trading performance.
