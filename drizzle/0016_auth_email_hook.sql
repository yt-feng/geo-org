-- Store hashes and delivery state only; never persist OTPs, email addresses or links.
CREATE TABLE IF NOT EXISTS auth_email_hook_messages (
  id TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auth_email_deliveries (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('sending','sent','unknown')),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auth_email_deliveries_status
  ON auth_email_deliveries(status,created_at);
