# ISSUE-390 — Deterministic SMC level map and prompt v5

The operator asked for a better prompt that gets precise support/resistance, order
blocks, FVGs and other smart-money and price-action levels. The operator chose three
things: deterministic code computes the levels; the counter-trend trigger sits beyond
the protecting structure; the new prompt goes live on the next deploy.

Provider revision `0.7.3-quick-oco.1-codex.2` follows the earlier prompt-only precedent
(`0.4.3-evidence-scalp.1-codex.2`). Policy `0.7.3-quick-oco.1` and every economic
constant stay unchanged: native TP 0.40, SL 7.00, dynamic shared 5% demo risk with at
most 2.5% per leg, STOP_LIMIT/GTC/OCO, all gates, protection and history. No claim is
made that entries improve; that needs prospective evidence.

## Why code computes the levels

A language model reading raw candle numbers rounds, misreads and invents levels. The
precise part is therefore frozen, causal code; the prompt makes Codex choose among
those exact prices and cite them. Each `reason` names its anchors and tick offsets,
so every proposal can be audited against the journaled input.

## `causal-smc-1.1` (additive)

`causal-smc-1.0` output, its code and its schemas are unchanged; 1.1 is the 1.0
evidence plus the fields below (`python/technical/levels.py`). Frame levels use
completed candles in the current session segment and never cross a marked broker
session gap. Session ranges use completed M5 history and censor any window with a
missing candle.

- `support_resistance` (per frame, at most 6, nearest first): clusters of two or more
  confirmed 3/3 fractal pivots within max(2 ticks, 0.25 × frame ATR, tick-rounded).
  Each has lower/upper bounds, touches, high/low pivot counts, first/last pivot and
  availability times, role relative to the quote, distance, and whether any later
  candle traded above or below it. Untraded highs/lows are liquidity hypotheses.
- `dealing_range` (per frame): the latest swing leg. The newest confirmed pivot pairs
  with the latest earlier opposite pivot beyond it, giving high, low, tick-rounded
  equilibrium and PREMIUM/DISCOUNT/EQUILIBRIUM/ABOVE_RANGE/BELOW_RANGE.
- Zones gain `midpoint` (order-block mean threshold / FVG consequent encroachment)
  and `penetration_fraction`, the deepest later trade into the zone.
- `candle_anatomy` (last 5 M1, 3 M5/M15): direction, range, range/ATR, body and wick
  fractions, close location, inside bar, engulfing and the 1.0 displacement test.
- `m1_envelopes`: exact highs/lows (with times) of the latest 3/5/10/20 completed M1.
- `sessions`: ASIA 00–07, LONDON 07–12, NEW_YORK 12–21 UTC conventions from completed
  M5 (no daylight-saving model), each COMPLETE, IN_PROGRESS or PARTIAL_OR_UNAVAILABLE;
  partial windows publish no high or low.
- `round_levels`: the 5- and 10-unit multiples bracketing the quote, labeled as
  psychological-level hypotheses, not liquidity.

These are descriptive definitions, not fitted thresholds or filters. The 0.25 ATR
tolerance and the counts are frozen choices that no backtest selected.

## Prompt `entry-quick-oco-v5`

What is new compared with v4:

- **Precision:** every output or cited price must be a supplied value plus or minus
  whole ticks. No eyeballed, averaged, rounded or remembered levels.
- **Definitions** match the code exactly: pivot, BOS/MSS/SWEEP, displacement, order
  block, FVG, mitigation, breaker/inverse zones, support/resistance clusters,
  liquidity, dealing range, sessions and candle anatomy.
- **Top-down procedure:** M15 then M5 bias, a level map both ways, and an M1 holding
  range taken from exact candle extremes.
- **With-trend trigger:** needs about 0.75 price units of room clear of fresh opposing
  M5/M15 zones, untaken opposing liquidity or a 3+ touch level. Recorded entry fills
  landed about 0.18 past the trigger and native TP fills needed about 0.15 beyond the
  TP ([fill evidence](fill-evidence-report.md)).
- **Counter-trend trigger:** goes beyond the nearest protecting swing pivot (M1, else
  M5) or the untaken liquidity or opposing zone just past it, never at a minor
  internal high or low inside the pullback. If it cannot be located precisely, WAIT.
- **Price action** is supporting evidence, never a gate.

Everything else carries over from v4: the fixed dual OCO description, WAIT semantics,
executable entry boundaries, the cost/TP/SL/risk text, no local profit close, memory
and tool limits, and the exact JSON output with response 1.2. The prompt is plain
ASCII, 8,932 bytes (v4 was 6,567).

Expected behavior changes, all unproven: fewer counter-trend fills, more WAITs when
room is blocked, and longer reasons. In the ISSUE-387 cohort Codex read 12 of 14
setups as bearish. All 4 counter-direction BUY fills triggered at minor internal highs
inside the 5-candle M1 envelope: 3 won small and 1 lost −1,832.77. That is 8 closes,
far too few to project an outcome.

## Contracts and versioning

- `technical-context-request-1.2` → analytics `/v3/technical-context` →
  `technical-context-response-1.1` with `causal-smc-1.1` and candidate
  `entry-context-candidate-1.1`. Requests 1.0/1.1 keep `/v1` and `/v2` and their 1.0
  response. For a 1.2 request the TS client rejects a legacy, unversioned or
  non-1.1 response or candidate. `scripts/prepare-technical-context.ts` accepts saved
  1.2 requests for offline candidates.
- `codex-entry-request-1.11` binds `entry-quick-oco-v5` to the 1.1 evidence; response
  1.2 is unchanged. The worker validates the new fields for look-ahead and provenance.
  A v4-pinned worker rejects 1.11 and a v5-pinned worker rejects 1.10 before any claim.
- Older prompts, schemas and request classes keep their bytes. A new prompt hash
  starts a new daily Codex thread; v4 contexts and WAITs are not reused, and the first
  v5 call waits the normal cooldowns.
- The ISSUE-387 30-day registration halts by design on release drift (it fingerprints
  `policy.ts` and the provider prompt, now v5). Register a fresh window for the new
  release if that study should continue.

## Deployment and rollback (operator)

1. Deploy the analytics service with `/v3` first; otherwise the technical context is
   unavailable and dispatch fails closed.
2. Deploy a new worker copy whose drop-in sets
   `CODEX_ENTRY_PROMPT_FILE=…/prompts/entry-quick-oco-v5.md` (the checked-in unit now
   points at v5).
3. Deploy the matching application and orchestrator, then restart the SELECT-only
   Flight recorder and any observer with `--release 0.7.3-quick-oco.1-codex.2`. They
   halt on a release mismatch by design.
4. Verify that the journaled provider input carries
   `"definitions_version":"causal-smc-1.1"` and that the reason cites supplied
   anchors, and confirm normal gated WAIT/proposal flow.

Rollback redeploys the `codex.1` application and v4 worker together. No migration or
data change is involved. Accepted groups keep their original prices and protection;
never cancel or reprice them to speed up a switch.

## Validation and limits

- Locally: 9 level-map tests (fractals, clustering/tolerance, dealing leg, zone
  midpoint/penetration, anatomy without cross-gap comparison, envelopes, sessions,
  round levels, canonical decimals) pass; ruff and strict mypy pass on the stdlib
  modules. New schemas come from an emulator of pydantic's JSON-schema rules that
  reproduces `technical-context-response-1.0.json` exactly, plus a `$ref`-closure check.
  The 1.1 response fixture validates against its schema.
- Hosted qualification must still pass: the pydantic schema-parity tests, the worker
  1.11 tests, TS client/transport/prompt tests and formatting. The sandbox could not
  install npm or pip dependencies, so these were not run locally. Exact local checks:
  [local validation](evidence/issue-390-local-validation.json).
- Limits: UTC session conventions ignore daylight saving; liquidity flags are later
  trades, not orders; fractals confirm three candles late; the 0.75 room and 0.15/0.18
  fill offsets come from 8 retained closes; the prompt adds about 2.4 KB and the
  context about 14 KB per call, inside the 64,000-byte candidate and 128,000-byte
  transport bounds.
