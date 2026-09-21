# ISSUE-111 — Grok model switch

The active new-request model is `grok-4.5`. The EPRToken chat-completions adapter
requires the returned model identity to be exactly `grok-4.5`; no fallback or
alias is accepted. Historical Astra, Sol and DeepSeek records remain immutable
and remain valid in the database constraint. The production entry-pair path
uses `reasoning_effort: low`; Grok rejects `none` and omission defaults to slow
high reasoning for this model.

The production entry-pair request is bounded to 120 M1 / 72 M5 / 48 M15 completed
candles and 1,024 completion tokens. A live-shaped probe with this bound returned
HTTP 200 in about 22 seconds; the former production payload exceeded the 90-second
deadline. Historical scenario/research limits remain unchanged.

The forward migration `0026_grok_context_model.sql` was applied to the local
demo database after an administrator backup. The AI and execution workers were
rebuilt and restarted with the updated policy. Runtime status reports
`requestedModel: grok-4.5`, automation `RUNNING`, and live execution remains
disabled.

The first post-deploy provider request is still subject to the existing failed-
context cooldown and market-session/readiness gates. No old context or audit
history was deleted or rewritten, and no profitability or provider-compatibility
claim is made until a fresh Grok response is observed and validated.
