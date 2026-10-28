# Exact-head qualification and main protection

Issue [#418](https://github.com/AegisFintech/scalping-bot/issues/418) addresses a prerequisite for the future publisher in #401. The qualification workflow explicitly checks out the pull-request head or pushed commit and asserts the checked-out SHA before running the existing full qualification. GitHub's [event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) explains that the default pull-request checkout is a synthetic merge commit.

Main protection is active and independently read back: an up-to-date pull request and the `qualify-exact-head` GitHub Actions status are required, administrators are included, and force pushes and branch deletion are disabled. The rule currently requires zero approving reviews. See the [sanitized protection receipt](evidence/main-protection-activation.json).

A status check alone is not an independent review. A pull request that can edit its own workflow can also weaken the job. The offline proposal policy does not prove source isolation, credential separation or a trusted review. Automatic publishing and merging remain disabled until those #401 prerequisites have separate, enforceable evidence.

Full local qualification passed: `PYTHONDONTWRITEBYTECODE=1 /opt/scalper-node22/bin/node scripts/qualify.mjs` completed all checks, including 1,173 Node, 132 PostgreSQL and 670 Python tests. An incorrect expected commit was rejected by the shell assertion. Independent standards and specification reviews found no blocker. The [sanitized receipt](evidence/exact-head-checks-validation.json) records source/runtime hashes and check results. The final hosted push and PR runs also passed.

Both final GitHub Actions runs passed and their checkout logs confirmed the exact reviewed head `7059a7ab9e76d9169eb71b728ea3b78cbf531aeb`; the workflow was merged in [PR #419](https://github.com/AegisFintech/scalping-bot/pull/419). The unattended publisher remains disabled: this protection does not establish an independent review or an immutable trusted workflow.
