# ISSUE-111 — Grok model switch

The active new-request model is `grok-4.5`. The EPRToken Responses adapter
requires the returned model identity to be exactly `grok-4.5`; no fallback or
alias is accepted. Historical Astra, Sol and DeepSeek records remain immutable
and remain valid in the database constraint.

The forward migration `0026_grok_context_model.sql` was applied to the local
demo database after an administrator backup. The AI and execution workers were
rebuilt and restarted with the updated policy. Runtime status reports
`requestedModel: grok-4.5`, automation `RUNNING`, and live execution remains
disabled.

The first post-deploy provider request is still subject to the existing failed-
context cooldown and market-session/readiness gates. No old context or audit
history was deleted or rewritten, and no profitability or provider-compatibility
claim is made until a fresh Grok response is observed and validated.
