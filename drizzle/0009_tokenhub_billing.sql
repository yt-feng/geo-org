CREATE TABLE IF NOT EXISTS tokenhub_billing (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  wallet_request_id TEXT NOT NULL,
  quote_json TEXT NOT NULL,
  task_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, idempotency_key),
  UNIQUE (user_id, wallet_request_id)
);
CREATE INDEX IF NOT EXISTS tokenhub_billing_task ON tokenhub_billing(user_id, task_id);
