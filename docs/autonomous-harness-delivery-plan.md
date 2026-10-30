# Autonomous harness — implementation queue

Operator authorization: plan the complete chain and work on it without repeated
permission. One demo executor; tc01 coordinates research and tc02 computes.
Initial baseline early30 October: demo ready/unpaused;32 completed scheduled
observation reviews, zero failures in the retained review counter. That proves
observation interpretation, not experiments, code delivery or profitability.

| Order | Task                                                                                                       | Dependency                                           | Completion proof                                                                                                                                             | State                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1     | [#448 Trusted source verification](https://github.com/AegisFintech/scalping-bot/issues/448)                | Existing scope policy #410 and worker #421           | Real Git objects → exact allowed files/digest; malicious objects/drift rejected; unprivileged protected-mirror probe                                         | Merged PR #453                                         |
| 2     | [#449 Hypothesis and job registration](https://github.com/AegisFintech/scalping-bot/issues/449)            | #448, current agenda #444/#445                       | Finding → frozen hypothesis/code/data/cost/test rule → durable job; duplicate and interrupted registration recover                                           | Merged PR #454                                         |
| 3     | [#450 tc02 execution and reconciliation](https://github.com/AegisFintech/scalping-bot/issues/450)          | #449, #421                                           | Actual job dispatched through restricted identity, result validated, finding attributed, plan closed; unknown dispatch never replayed                        | Merged PR #455; recurring closure verified             |
| 4     | [#451 Candidate code and independent attestation](https://github.com/AegisFintech/scalping-bot/issues/451) | #450                                                 | Result-derived research patch tested against independent fixtures, exact source/result binding and separately controlled review                              | Complete first bounded task; reviewed PR #461 merged   |
| 5     | [#452 Trusted GitHub publisher](https://github.com/AegisFintech/scalping-bot/issues/452)                   | #448/#451                                            | Actual commit/push/PR plus duplicate/unknown-outcome reconciliation; exact-head checks and independent review enforced                                       | Local timer active; reviewed PR #461 merged            |
| 6     | [#403 Dashboard and qualified rollout](https://github.com/AegisFintech/scalping-bot/issues/403)            | #450/#452; economic evidence for any strategy change | Dashboard links question/job/result/finding/PR/release; matched immutable demo release and compatible rollback verified                                      | Monitor/dashboard active; remaining acceptance pending |
| 7     | [#431 Unattended qualification](https://github.com/AegisFintech/scalping-bot/issues/431)                   | All operational pieces                               | One complete natural cycle, negative/rejected trial, process restart and remote failure recovery, measured health/staleness and next work; no manual nudging | Recurring generation/review and natural cycle pending  |

Work follows these dependencies; a completed prerequisite is not completion of
#398/#401/#402. Every batch gets tests, independent review, full qualification,
pushed PR, permitted activation and a receipt. Close only its actual acceptance.
Do not enable a root Codex supervisor, alter frozen studies or replay old unknown jobs.
The remaining queue is an implementation plan, not a promise that the observation
timer implements new features after this coding session ends.

## What the autonomous loop may change

Research can propose hypotheses, retain negative findings, run registered isolated
experiments and publish qualified research/engineering changes. Model-generated
code cannot edit the verifier, protected original tests, instructions, execution,
risk, credentials, workflows, deployment gates or its own permissions. The publisher
must use independently controlled README/AGENTS templates without letting those
protected files become a back door around the candidate scope policy.

Economic activation requires separately reviewed, versioned evidence and a compatible
release. Software checks do not establish trading improvement. Costs, gaps, open
outcomes, nonfills, partials and all attempted variants remain visible. Descriptive
retrospective work is not preregistered evaluation. External calendar/DOM research
uses existing #326/#327; unavailable external data stays explicit rather than fabricated.

## Completion definition

A recorded observation creates an attributable question; a registered experiment
runs on tc02; its validated result creates a supported or negative finding; an
eligible code change creates a real reviewed PR; qualifying engineering changes
merge; any separately eligible demo release is verified after deployment. Failed
or rejected cases retain exact reasons and recover without duplicate work. A model
summary, green process, elapsed collection window or one winning trade is insufficient.

### Local publication acceptance

#451/#452 completed their first bounded code/publication acceptance with PR #461
and verified natural duplicate/merged reconciliation. The publisher is scheduled;
generation/signing/final review in this demonstration were operator-directed.
Remaining #431 work is recurring eligible-candidate orchestration and independently
controlled review, followed by natural end-to-end failure/restart proof. #403 retains
its remaining integrated/qualified rollout acceptance; software PASS never authorizes
economic promotion. No operator permission is pending for this next implementation.
