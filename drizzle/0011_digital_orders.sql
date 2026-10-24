CREATE TABLE IF NOT EXISTS digital_orders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,
 product_id TEXT NOT NULL,
 product_name TEXT NOT NULL,
 retail_cents INTEGER NOT NULL CHECK(retail_cents > 0),
 charge_microusd INTEGER NOT NULL CHECK(charge_microusd > 0),
 usd_cny TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','cancelled')),
 processed_by TEXT REFERENCES users(id),
 processed_at TEXT,
 delivery TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,request_key)
);
CREATE INDEX IF NOT EXISTS digital_orders_user_created ON digital_orders(user_id,created_at);
CREATE TRIGGER IF NOT EXISTS digital_order_reserve AFTER INSERT ON digital_orders
BEGIN
 INSERT INTO wallet_reservations(user_id,request_id,reserved_microusd,description,metadata_json)
 VALUES(NEW.user_id,'order:'||NEW.id,NEW.charge_microusd,'数字商品订单：'||NEW.product_name,'{}');
END;
CREATE TRIGGER IF NOT EXISTS digital_order_finish AFTER UPDATE OF status ON digital_orders
WHEN OLD.status IN ('pending','processing') AND NEW.status IN ('completed','cancelled')
BEGIN
 UPDATE wallet_reservations
 SET status=CASE WHEN NEW.status='completed' THEN 'settled' ELSE 'refunded' END,
 charged_microusd=CASE WHEN NEW.status='completed' THEN NEW.charge_microusd ELSE 0 END,
 description=CASE WHEN NEW.status='completed' THEN '数字商品已交付：' ELSE '数字商品订单取消，释放预留：' END||NEW.product_name,
 updated_at=CURRENT_TIMESTAMP
 WHERE user_id=NEW.user_id AND request_id='order:'||NEW.id AND status='reserved' AND reserved_microusd=NEW.charge_microusd;
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'order_wallet_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS digital_order_immutable BEFORE UPDATE ON digital_orders
WHEN OLD.status IN ('completed','cancelled') OR NEW.user_id<>OLD.user_id OR NEW.charge_microusd<>OLD.charge_microusd OR NEW.product_id<>OLD.product_id
 OR NEW.retail_cents<>OLD.retail_cents OR NEW.usd_cny<>OLD.usd_cny OR NEW.request_key<>OLD.request_key OR NEW.product_name<>OLD.product_name
BEGIN SELECT RAISE(ABORT,'order_immutable'); END;
CREATE TRIGGER IF NOT EXISTS digital_order_transition BEFORE UPDATE OF status ON digital_orders
WHEN NOT ((OLD.status='pending' AND NEW.status IN ('processing','cancelled'))
 OR (OLD.status='processing' AND NEW.status IN ('completed','cancelled')))
 OR (NEW.status='processing' AND NEW.processed_by IS NULL)
BEGIN SELECT RAISE(ABORT,'order_transition_invalid'); END;
