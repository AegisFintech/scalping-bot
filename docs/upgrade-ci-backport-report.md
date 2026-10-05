# ISSUE-259 — Qualification fixes on earlier stacked heads

The final combined upgrade passed, but standalone PRs #265–#268 still carried
older failing CI heads. Backport the already reviewed fixture corrections from
#269 into #265, then merge that ancestor forward through the dependent branches.
No force-push, history rewrite, production behavior change or deployment is needed.

The entry-retirement fixture observes in a later millisecond than PostgreSQL's
microsecond provider availability. It asserts successful retirement before claiming
the replacement. Storage tests isolate their process inventory while inspecting
a real held-open descriptor; a separate permission-denial regression proves logs
remain intact when inventory is uncertain. Production fail-closed gates stay intact.

Validation on the corrected #265 source: pinned Node 22.23.2, Python 3.13.5,
`PATH=/opt/scalper-node22/bin:$PATH npm run qualify`: every phase passed.
Full formatting, lint, types and isolated build; 798 Node tests in 101 files,
70 disposable TLS PostgreSQL lifecycle tests, 251 Python tests, no skips;
secret scan and both audits clean. Private logs:
`/tmp/scalper-qualification-HJZOed/checks`. Focused storage tests: 16 passed.
The earlier qualification report format predates the later release fingerprint
contract and must not be substituted for a release-preparation report.

Dependent heads receive the same two test corrections and their own fresh hosted
checks. Parent merges preserve the existing source changes and all historical CI
runs. A PR may merge only after its current head and applicable requirements pass;
old failed runs are neither bypassed nor relabelled. This follow-up supersedes
only the earlier-head CI blocker in the original delivery report. Runtime rollout,
private off-host backups and independent economic qualification remain separate.
