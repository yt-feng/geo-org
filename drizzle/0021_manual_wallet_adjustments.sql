PRAGMA foreign_keys = ON;

-- Manual service credit is recorded separately from a Paddle payment or refund.
-- A single insert commits both the operator audit and the wallet grant.
CREATE TABLE IF NOT EXISTS tokvilo_manual_wallet_adjustments (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE,
 payment_reference TEXT NOT NULL UNIQUE,
 fingerprint TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 customer_email TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 actor_email TEXT NOT NULL,
 amount_microusd INTEGER NOT NULL CHECK(typeof(amount_microusd)='integer' AND amount_microusd BETWEEN 10000 AND 100000000000),
 reason TEXT NOT NULL CHECK(reason IN ('bank_transfer','test_credit','correction')),
 receipt_confirmed INTEGER NOT NULL CHECK(receipt_confirmed IN (0,1) AND (reason!='bank_transfer' OR receipt_confirmed=1)),
 note TEXT NOT NULL CHECK(length(note) BETWEEN 2 AND 1000),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS tokvilo_manual_wallet_owner ON tokvilo_manual_wallet_adjustments(user_id,created_at);

CREATE TRIGGER IF NOT EXISTS tokvilo_manual_wallet_guard BEFORE INSERT ON tokvilo_manual_wallet_adjustments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND status='active')
 THEN RAISE(ABORT,'manual_actor_disabled') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND status='active' AND lower(trim(email))=NEW.customer_email)
 OR (SELECT count(*) FROM users WHERE lower(trim(email))=NEW.customer_email)!=1
 THEN RAISE(ABORT,'manual_customer_changed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM tokvilo_manual_wallet_adjustments WHERE (request_id=NEW.request_id OR payment_reference=NEW.payment_reference) AND fingerprint!=NEW.fingerprint)
 THEN RAISE(ABORT,'manual_credit_conflict') END;
END;

CREATE TRIGGER IF NOT EXISTS tokvilo_manual_wallet_credit AFTER INSERT ON tokvilo_manual_wallet_adjustments BEGIN
 INSERT INTO wallet_ledger(id,user_id,kind,amount_microusd,reference_id,description)
 VALUES('manual:'||NEW.id,NEW.user_id,'manual_'||NEW.reason,NEW.amount_microusd,NEW.id,
 CASE NEW.reason WHEN 'bank_transfer' THEN 'Enterprise bank transfer confirmed' WHEN 'test_credit' THEN 'Test service credit' ELSE 'Service credit correction' END);
END;

CREATE TRIGGER IF NOT EXISTS tokvilo_manual_wallet_no_update BEFORE UPDATE ON tokvilo_manual_wallet_adjustments BEGIN
 SELECT RAISE(ABORT,'manual_audit_immutable');
END;
CREATE TRIGGER IF NOT EXISTS tokvilo_manual_wallet_no_delete BEFORE DELETE ON tokvilo_manual_wallet_adjustments BEGIN
 SELECT RAISE(ABORT,'manual_audit_immutable');
END;
