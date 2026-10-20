PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wallet_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 balance_microusd INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL,
 amount_microusd INTEGER NOT NULL,
 reference_id TEXT NOT NULL,
 description TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS wallet_ledger_owner ON wallet_ledger(user_id, created_at);
CREATE TRIGGER IF NOT EXISTS wallet_ledger_balance AFTER INSERT ON wallet_ledger BEGIN
 INSERT INTO wallet_accounts(user_id,balance_microusd) VALUES(NEW.user_id,NEW.amount_microusd)
 ON CONFLICT(user_id) DO UPDATE SET balance_microusd=balance_microusd+NEW.amount_microusd,updated_at=CURRENT_TIMESTAMP;
END;

CREATE TABLE IF NOT EXISTS wallet_reservations (
 user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 reserved_microusd INTEGER NOT NULL CHECK(reserved_microusd>=0),
 charged_microusd INTEGER CHECK(charged_microusd>=0 AND charged_microusd<=reserved_microusd),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','refunded')),
 description TEXT NOT NULL,
 metadata_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,request_id)
);
CREATE TRIGGER IF NOT EXISTS wallet_reservation_guard BEFORE INSERT ON wallet_reservations
 WHEN NOT EXISTS(SELECT 1 FROM wallet_reservations WHERE user_id=NEW.user_id AND request_id=NEW.request_id)
 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND status='active') THEN RAISE(ABORT,'wallet_account_disabled') END;
 SELECT CASE WHEN COALESCE((SELECT balance_microusd FROM wallet_accounts WHERE user_id=NEW.user_id),0)<NEW.reserved_microusd THEN RAISE(ABORT,'insufficient_balance') END;
END;
CREATE TRIGGER IF NOT EXISTS wallet_reservation_debit AFTER INSERT ON wallet_reservations BEGIN
 INSERT INTO wallet_ledger(id,user_id,kind,amount_microusd,reference_id,description)
 VALUES('reserve:'||length(NEW.user_id)||':'||NEW.user_id||':'||NEW.request_id,NEW.user_id,'reserve',-NEW.reserved_microusd,NEW.request_id,NEW.description);
END;
CREATE TRIGGER IF NOT EXISTS wallet_reservation_finalize AFTER UPDATE OF status ON wallet_reservations
 WHEN OLD.status='reserved' AND NEW.status IN ('settled','refunded') BEGIN
 INSERT INTO wallet_ledger(id,user_id,kind,amount_microusd,reference_id,description)
 VALUES('finalize:'||length(NEW.user_id)||':'||NEW.user_id||':'||NEW.request_id,NEW.user_id,NEW.status,NEW.reserved_microusd-NEW.charged_microusd,NEW.request_id,NEW.description);
END;

-- Tokvilo inventory is independent of JiaNong. Issuing or redeeming a code is
-- fulfillment; it is not a claim that a platform payment or refund occurred.
CREATE TABLE IF NOT EXISTS tokvilo_redemption_batches (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE,
 fingerprint TEXT NOT NULL,
 package_id TEXT NOT NULL,
 amount_cny INTEGER NOT NULL CHECK(amount_cny>0),
 credit_microusd INTEGER NOT NULL CHECK(credit_microusd>0),
 usd_cny TEXT NOT NULL,
 count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 1000),
 note TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 expires_at TEXT
);
CREATE TABLE IF NOT EXISTS tokvilo_redemption_codes (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES tokvilo_redemption_batches(id),
 code_hash TEXT NOT NULL UNIQUE,
 code_suffix TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','redeemed','revoked')),
 redeemed_by TEXT REFERENCES users(id),
 redeemed_at TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tokvilo_codes_batch ON tokvilo_redemption_codes(batch_id,status);
CREATE TABLE IF NOT EXISTS tokvilo_redemptions (
 code_id TEXT PRIMARY KEY REFERENCES tokvilo_redemption_codes(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 amount_cny INTEGER NOT NULL,
 credit_microusd INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tokvilo_redemptions_owner ON tokvilo_redemptions(user_id,created_at);
CREATE TABLE IF NOT EXISTS tokvilo_redemption_revocations (
 code_id TEXT PRIMARY KEY REFERENCES tokvilo_redemption_codes(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 note TEXT NOT NULL,
 credit_reversed_microusd INTEGER NOT NULL,
 created_at TEXT NOT NULL
);

-- An operator can import prepared inventory with one SQL statement. D1 runs
-- this INSERT and both triggers in one transaction; an interrupted/replayed
-- upload never produces a second batch or a partially usable inventory.
CREATE TABLE IF NOT EXISTS tokvilo_inventory_imports (
 id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL,
 inventory_json TEXT NOT NULL CHECK(json_valid(inventory_json)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER IF NOT EXISTS tokvilo_inventory_identity BEFORE INSERT ON tokvilo_inventory_imports BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM tokvilo_inventory_imports WHERE id=NEW.id AND fingerprint!=NEW.fingerprint)
 THEN RAISE(ABORT,'inventory_import_conflict') END;
 SELECT CASE WHEN json_type(NEW.inventory_json)!='array' OR json_array_length(NEW.inventory_json)<1
 THEN RAISE(ABORT,'inventory_invalid') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.inventory_json) b
  WHERE json_array_length(json_extract(b.value,'$.codes'))!=json_extract(b.value,'$.count')
  OR NOT EXISTS(SELECT 1 FROM users WHERE id=json_extract(b.value,'$.created_by') AND status='active')
 ) THEN RAISE(ABORT,'inventory_invalid') END;
END;
CREATE TRIGGER IF NOT EXISTS tokvilo_inventory_commit AFTER INSERT ON tokvilo_inventory_imports BEGIN
 INSERT INTO tokvilo_redemption_batches(id,request_id,fingerprint,package_id,amount_cny,credit_microusd,usd_cny,count,note,created_by,created_at,expires_at)
 SELECT json_extract(b.value,'$.id'),json_extract(b.value,'$.request_id'),json_extract(b.value,'$.fingerprint'),
 json_extract(b.value,'$.package_id'),json_extract(b.value,'$.amount_cny'),json_extract(b.value,'$.credit_microusd'),
 json_extract(b.value,'$.usd_cny'),json_extract(b.value,'$.count'),json_extract(b.value,'$.note'),
 json_extract(b.value,'$.created_by'),json_extract(b.value,'$.created_at'),json_extract(b.value,'$.expires_at')
 FROM json_each(NEW.inventory_json) b;
 INSERT INTO tokvilo_redemption_codes(id,batch_id,code_hash,code_suffix,created_at)
 SELECT json_extract(c.value,'$.id'),json_extract(b.value,'$.id'),json_extract(c.value,'$.code_hash'),
 json_extract(c.value,'$.code_suffix'),json_extract(b.value,'$.created_at')
 FROM json_each(NEW.inventory_json) b,json_each(json_extract(b.value,'$.codes')) c;
END;
