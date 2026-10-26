-- Immutable broker close-deal evidence for full/partial external/native outcomes.
-- No historical backfill or deletion; accepted events populate prospectively/recovery.
CREATE TABLE position_close_deals (
 account_id uuid NOT NULL REFERENCES accounts(id), symbol_id uuid NOT NULL REFERENCES symbols(id),
 position_id uuid NOT NULL REFERENCES positions(id), broker_deal_id text NOT NULL,
 broker_order_id text NOT NULL, closed_volume numeric(30,10) NOT NULL CHECK(closed_volume>0),
 entry_price numeric(30,10) NOT NULL CHECK(entry_price>0),
 gross_profit numeric(30,10) NOT NULL, commission numeric(30,10) NOT NULL,
 swap numeric(30,10) NOT NULL, conversion_fee numeric(30,10) NOT NULL,
 occurred_at timestamptz NOT NULL, external_intervention boolean NOT NULL,
 evidence_hash char(64) NOT NULL CHECK(evidence_hash ~ '^[0-9a-f]{64}$'), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,broker_deal_id), UNIQUE(position_id,broker_deal_id),
 CHECK(broker_deal_id ~ '^[0-9]{1,32}$'), CHECK(broker_order_id ~ '^[0-9]{1,32}$')
);
CREATE INDEX position_close_deals_position_time ON position_close_deals(position_id,occurred_at);
CREATE FUNCTION immutable_position_close_deals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'POSITION_CLOSE_DEAL_IMMUTABLE'; END $$;
CREATE TRIGGER position_close_deals_immutable BEFORE UPDATE OR DELETE ON position_close_deals
 FOR EACH ROW EXECUTE FUNCTION immutable_position_close_deals();
