# ISSUE-302 — Bounded Codex research proposals

Issue: https://github.com/AegisFintech/scalping-bot/issues/302.

## Delivered scope

A separate Python worker schedules aggregate demo-result reviews and sourced
SMC/support/resistance hypotheses. It does not change the production trading loop,
replace Grok, evaluate generated strategies or establish an economic improvement.
Reports always say HOLD, no broker/promotion authority and evaluationPerformed=false.
External citations are explicitly model-reported, not independently verified facts.

`python.research.codex_loop` accepts only the versioned aggregate evidence contract;
`prepare_evidence` projects an existing `demo:learning-review` export onto that
allowlist. Individual trades, account/order identities, raw broker events and
credentials are not passed through. Decimal money strings and unknown provider
cost remain unchanged. Missing close-cost corroboration remains an explicit count.
Closed-trade P/L is not account return or actual filled-position risk.

The existing current-policy fade transform discards model-selected levels.
Prompt-only entry improvements cannot establish better execution. SMC and
support/resistance are research priorities, not proven highest-accuracy methods.

## Scheduling and durability

- One daily UTC review; one weekly ISO-calendar research batch, at most eight
  attempts in any rolling seven days. These are call-count and time bounds, not
  a guaranteed token/spending limit or reservation of subscription capacity.
- One process at a time, using an OS lock. Claims are flushed before dispatch;
  failures, quota errors, malformed output, crashes and unknown outcomes are not
  automatically retried in the same period. Never delete claims to regain budget.
- Evidence must end no more than 36 hours ago and must not include future dates;
  maximum cohort is 31 days. Missing/stale input blocks research only.
- Each claim records input, prompt and worker SHA-256 digests. Input snapshot,
  generated output and completion/failure report stay private. Exclusive publication
  never overwrites an earlier artifact. Partial files fail closed; they are not
  completed reports and require investigation, not automatic repair or replay.
- Codex has a 180-second deadline, process-group termination on timeout, bounded
  response reads and structured validation. Raw provider errors are never printed.
- Daily jobs return observations/limitations only. Weekly jobs may propose up to
  two single-change candidates with sources, causal rules, baseline, evaluation
  and rejection criteria. Missing verified sources may yield zero candidates.
- No generated code is executed; no GitHub credential is available to the worker.
  Reports are review artifacts, not automatically published issues or PRs.

There is no promise of automatic improvement. Future candidate implementation,
chronological testing, trial accounting, shadow registration and PR production are
tracked in [#304](https://github.com/AegisFintech/scalping-bot/issues/304). The
simplified trading/Codex integration is tracked in
[#303](https://github.com/AegisFintech/scalping-bot/issues/303). Existing #301 recovery
and #289/#290 evidence/protocol work are not bypassed by this worker.

## Subscription and isolation

Codex CLI supports `exec`, saved ChatGPT authentication and JSON Schema output.
The host CLI reports version 0.163.0 and ChatGPT sign-in. This does not verify the
user's subscription tier, remaining quota, successful inference or response latency.
Official references: [non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
and [authentication](https://learn.chatgpt.com/docs/auth).

The production adapter refuses root. Install under a dedicated `scalper-research`
OS account with home `/var/lib/scalper-research`, no supplementary trading groups,
no broker/database/GitHub credentials, and its own interactive `codex login`.
Do not copy root's authentication file. It uses the account's saved Codex auth;
API-key environment variables, caller PATH and user config are not inherited.
The CLI's configured default model is used: this is exploratory proposal generation,
not a pinned-model economic experiment. Model identity/usage measurement is still
required for #303. No subscription-authenticated call was made in this delivery.

The systemd templates run that user with read-only system paths, inaccessible root,
trading releases and PostgreSQL socket directory, a private temporary directory,
25% CPU, 512 MiB RAM, 1 MiB file cap and four-minute service deadline. Codex itself
uses a read-only sandbox. Dedicated-user access controls are essential: read-only
sandboxing alone does not prevent reading secrets. The worker has internet access
for Codex and weekly research; do not install trading credentials in its home.

## Installation and activation checklist

Templates are provided but not installed/enabled. No runtime services were restarted.

1. Install a reviewed copy of `python/research`, its Python environment and Codex
   binary under `/opt/scalper-research` and `/usr/local/bin`, respectively. Keep
   source/binaries root-owned. Set up the dedicated user and private home.
2. Sign in as that user using the supported Codex login flow. Do not put tokens in
   commands, GitHub or reports. A login/latency/quota smoke test must succeed before
   enabling timers. Login is an operator interaction; the root login is insufficient.
3. A separate trusted exporter runs the existing read-only learning review with
   explicit release/start/end, then projects its output:

   ```sh
   .venv/bin/python -m python.research.prepare_evidence \
     --input /private/learning-export.json --output /private/aggregate-new.json
   ```

   The output is exclusively created. A trusted feeder must validate and atomically
   publish this aggregate as `/var/lib/scalper-research/inbox/latest.json`, readable
   by the research user. Do not expose the exporter's database environment to Codex.
   The fresh-feed deployment is outstanding in #304; stale files are rejected.

4. Test one manual invocation as the dedicated user, inspect its report, then install
   `scalper-codex-research@.service` and both timer files. Daily runs at 02:30 UTC;
   weekly runs Monday at 03:00 UTC. No timers are activated by repository commands.
5. Independently verify sources and review the report before creating candidate
   implementation issues. Existing #253/#255 retain all causal/censoring/null-cost
   limits. Never use the legacy optimizer as a qualification shortcut.

Rollback: disable only the two research timers. Preserve all claims, reports and
failure artifacts; trading/risk/accounting and frozen research need no rollback.
Artifacts are local only and have no new backup policy. No retention deletion job
is installed. Monitor private storage growth before prolonged operation.

## Validation

Pending full qualification; commands/results will be recorded before handoff.
