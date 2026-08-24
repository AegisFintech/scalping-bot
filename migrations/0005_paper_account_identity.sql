-- Paper simulation state must never share the identity or daily-risk baseline of
-- a broker-backed demo/live account. This widens only the identity enums; no
-- account data is rewritten or deleted.
ALTER TABLE accounts
  DROP CONSTRAINT accounts_provider_check,
  DROP CONSTRAINT accounts_environment_check,
  DROP CONSTRAINT accounts_account_type_check,
  ADD CONSTRAINT accounts_provider_check
    CHECK (provider IN ('paper', 'ctrader')),
  ADD CONSTRAINT accounts_environment_check
    CHECK (environment IN ('paper', 'demo', 'live')),
  ADD CONSTRAINT accounts_account_type_check
    CHECK (account_type IN ('paper', 'demo', 'live'));
