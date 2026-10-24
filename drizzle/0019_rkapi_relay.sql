CREATE TABLE IF NOT EXISTS rkapi_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  wallet_request_id TEXT NOT NULL,
  model TEXT NOT NULL,
  quote_json TEXT NOT NULL,
  response_json TEXT,
  status_code INTEGER,
  state TEXT NOT NULL CHECK(state IN ('pending','completed','failed','unknown')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS rkapi_requests_owner ON rkapi_requests(user_id,created_at);
