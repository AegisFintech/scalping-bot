# ISSUE-400 offline replay

The offline CLI reconstructs the current single STOP_LIMIT/GTD journal contract
and retains WAIT, failure, rejected, open, partial and unsupported denominators.
It has no broker, provider, database mutation, registration or promotion authority.
Every result is `RECONSTRUCTION_ONLY` and `HOLD`. The CLI validates the raw
packet digest before parsing. Callers of the pure Python `replay()` function must
independently validate the raw bytes and digest; the model alone cannot attest the
original serialized packet.

Verified Flight chains can support sampled executable-side stop activation,
limit eligibility and observed excursions. A range is a declared hypothesis, not
a retained broker acknowledgement. A crossing does not prove a fill or exit
cause. Gaps, stale sides, overlapping or unordered observations and missing
protection remain explicit. Partial-close paths are censored. Recorded net already
includes broker fees. Currency is account metadata observed at export; historical
currency is not independently attested. Calculations use a scoped 100-digit decimal
context; repeating results are rounded half-even to at most 40 fractional places
for output. Unknown provider costs, counterfactual fills, FX, margin,
after-cost time to profit and portfolio drawdown stay null.

The deterministic benchmark uses completed M15/M5 trend and a five-candle M1
breakout on the same recorded context. It cannot fabricate a new provider stream,
a fill or a dynamically resized portfolio. A draft protocol records proposed
chronological windows, purge/embargo and attempt inventory; it is not a
registration, and numerical thresholds remain pending review. Its source hash is
for this module only, not a full dependency-closure or deployment attestation.
No forward study is registered or activated by this batch.

The actual bounded bridge packet from 28 October was processed without order or
provider calls: it included one older-release setup, which was explicitly
unsupported. A separate SELECT-only journal count found zero scoped setups for the current
release at the time of the check. This does not prove that the broker account is
flat. See the [sanitized smoke receipt](evidence/scalp-replay-smoke-20261028.json).
Synthetic current-release tests establish software behavior; they do not establish
historical execution accuracy or profitability. Issue #400 remains open until its
factual current-release journal reconstruction and broader research acceptance can
be verified. Software-only delivery is tracked by issue #409. Issue #407 tracks
future native acknowledgement capture; unavailable historical fields cannot be
reconstructed from intent or the current policy.

The prior paired replay, existing historical contracts and frozen prospective
registrations remain immutable. No demo strategy, risk, service or account state
is changed. Both independent source reviews found no blocker in this software-only scope.
Full qualification and GitHub checks must pass before merging.
