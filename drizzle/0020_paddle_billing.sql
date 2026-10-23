-- Paddle funds only Tokvilo's own API service usage. Payment state is retained
-- independently of browser checkout events and the general wallet balance.
CREATE TABLE IF NOT EXISTS paddle_orders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 package_id TEXT NOT NULL CHECK(package_id IN ('20','50','100')),
 environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 price_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents IN (2000,5000,10000)),
 credit_microusd INTEGER NOT NULL CHECK(credit_microusd=amount_cents*10000),
 binding_secret TEXT NOT NULL,
 transaction_id TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','checkout_ready','outcome_unknown','paid','adjusted','canceled')),
 applied_credit_microusd INTEGER NOT NULL DEFAULT 0 CHECK(applied_credit_microusd>=0 AND applied_credit_microusd<=credit_microusd),
 reconciliation_version INTEGER NOT NULL DEFAULT 0,
 lock_token TEXT,
 lock_until INTEGER NOT NULL DEFAULT 0,
 last_checked_at INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS paddle_orders_owner ON paddle_orders(user_id,created_at);
CREATE TABLE IF NOT EXISTS paddle_events (
 event_id TEXT PRIMARY KEY,
 event_type TEXT NOT NULL,
 transaction_id TEXT NOT NULL,
 order_id TEXT NOT NULL REFERENCES paddle_orders(id),
 occurred_at TEXT NOT NULL,
 processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER IF NOT EXISTS paddle_order_credit AFTER UPDATE OF applied_credit_microusd ON paddle_orders
 WHEN NEW.environment='production' AND NEW.applied_credit_microusd != OLD.applied_credit_microusd BEGIN
 SELECT CASE WHEN NEW.reconciliation_version != OLD.reconciliation_version+1
 THEN RAISE(ABORT,'paddle_invalid_reconciliation') END;
 INSERT INTO wallet_ledger(id,user_id,kind,amount_microusd,reference_id,description)
 VALUES('paddle:'||NEW.id||':'||NEW.reconciliation_version,NEW.user_id,
 CASE WHEN NEW.applied_credit_microusd>OLD.applied_credit_microusd THEN 'paddle_service_credit' ELSE 'paddle_service_adjustment' END,
 NEW.applied_credit_microusd-OLD.applied_credit_microusd,NEW.transaction_id,
 CASE WHEN NEW.applied_credit_microusd>OLD.applied_credit_microusd THEN 'Tokvilo API service usage' ELSE 'Tokvilo API service payment adjustment' END);
END;
