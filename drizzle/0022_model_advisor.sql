PRAGMA foreign_keys = ON;

-- Free advisor calls have their own conservative operating allowance. They
-- never reserve, debit, or credit a customer's wallet. Prompts are not stored.
CREATE TABLE IF NOT EXISTS model_advisor_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','ai','fallback')),
  reserved_microusd INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved_microusd)='integer' AND reserved_microusd BETWEEN 0 AND 5000),
  service TEXT CHECK(service IN ('gateway','studio')),
  model_id TEXT,
  response_json TEXT,
  PRIMARY KEY(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS model_advisor_daily ON model_advisor_requests(day,user_id);
CREATE INDEX IF NOT EXISTS model_advisor_recent ON model_advisor_requests(user_id,created_at);

CREATE TRIGGER IF NOT EXISTS model_advisor_claim_guard BEFORE INSERT ON model_advisor_requests
WHEN NOT EXISTS(SELECT 1 FROM model_advisor_requests WHERE user_id=NEW.user_id AND request_id=NEW.request_id)
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND status='active') THEN RAISE(ABORT,'advisor_account_disabled') END;
  SELECT CASE WHEN NEW.day!=strftime('%Y-%m-%d',NEW.created_at,'unixepoch') OR NEW.state!='pending' OR NEW.reserved_microusd!=0
    THEN RAISE(ABORT,'advisor_invalid_claim') END;
  SELECT CASE WHEN (SELECT count(*) FROM model_advisor_requests WHERE user_id=NEW.user_id AND day=NEW.day)>=20
    OR (SELECT count(*) FROM model_advisor_requests WHERE day=NEW.day)>=2000
    OR (SELECT count(*) FROM model_advisor_requests WHERE user_id=NEW.user_id AND created_at>NEW.created_at-60)>=3
    THEN RAISE(ABORT,'advisor_quota_exceeded') END;
END;

CREATE TRIGGER IF NOT EXISTS model_advisor_update_guard BEFORE UPDATE ON model_advisor_requests BEGIN
  SELECT CASE WHEN NEW.user_id!=OLD.user_id OR NEW.request_id!=OLD.request_id OR NEW.input_hash!=OLD.input_hash OR NEW.day!=OLD.day OR NEW.created_at!=OLD.created_at
    THEN RAISE(ABORT,'advisor_request_immutable') END;
  SELECT CASE WHEN NEW.reserved_microusd<OLD.reserved_microusd OR (OLD.state!='pending' AND NEW.reserved_microusd!=OLD.reserved_microusd)
    THEN RAISE(ABORT,'advisor_allowance_immutable') END;
  SELECT CASE WHEN (OLD.state='pending' AND NEW.state NOT IN ('running','fallback'))
    OR (OLD.state='running' AND NEW.state NOT IN ('ai','fallback')) OR OLD.state IN ('ai','fallback')
    THEN RAISE(ABORT,'advisor_invalid_transition') END;
  SELECT CASE WHEN NEW.state='running' AND (NEW.reserved_microusd<1 OR NEW.model_id IS NULL OR NEW.service IS NULL)
    THEN RAISE(ABORT,'advisor_missing_price') END;
  SELECT CASE WHEN NEW.reserved_microusd>OLD.reserved_microusd AND
    (SELECT COALESCE(sum(reserved_microusd),0) FROM model_advisor_requests WHERE day=NEW.day)+NEW.reserved_microusd-OLD.reserved_microusd>500000
    THEN RAISE(ABORT,'advisor_budget_exceeded') END;
END;
