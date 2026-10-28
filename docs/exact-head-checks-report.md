# Exact-head qualification and main protection

Issue [#418](https://github.com/AegisFintech/scalping-bot/issues/418) addresses a prerequisite for the future publisher in #401. The qualification workflow explicitly checks out the pull-request head or pushed commit and asserts the checked-out SHA before running the existing full qualification. GitHub's [event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) explains that the default pull-request checkout is a synthetic merge commit.

Planned main protection requires an up-to-date pull request and the `qualify-exact-head` GitHub Actions status, enforces the rule for administrators, and blocks force pushes and branch deletion. The protection is not active until the server response is verified. It must not overwrite a pre-existing rule or bypass failing checks.

A status check alone is not an independent review. A pull request that can edit its own workflow can also weaken the job. The offline proposal policy does not prove source isolation, credential separation or a trusted review. Automatic publishing and merging remain disabled until those #401 prerequisites have separate, enforceable evidence.
