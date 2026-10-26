CREATE TABLE IF NOT EXISTS apimart_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  wallet_request_id TEXT NOT NULL,
  quote_json TEXT NOT NULL,
  response_json TEXT,
  status_code INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS apimart_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  wallet_request_id TEXT NOT NULL,
  response_json TEXT,
  poll_count INTEGER NOT NULL DEFAULT 0,
  next_poll_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS apimart_tasks_owner ON apimart_tasks(user_id, created_at);
