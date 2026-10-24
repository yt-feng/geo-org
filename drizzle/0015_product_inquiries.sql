CREATE TABLE IF NOT EXISTS product_inquiries (
  id TEXT PRIMARY KEY,
  idempotency_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_variant TEXT NOT NULL,
  upstream_cents INTEGER NOT NULL CHECK (upstream_cents >= 0),
  retail_cents INTEGER NOT NULL CHECK (retail_cents >= 0),
  price_currency TEXT NOT NULL DEFAULT 'CNY' CHECK (price_currency = 'CNY'),
  source_url TEXT NOT NULL,
  source_observed_at TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_message TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending','sending','sent')),
  email_attempts INTEGER NOT NULL DEFAULT 0 CHECK (email_attempts >= 0 AND email_attempts <= 12),
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_email_error TEXT,
  email_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS product_inquiries_pending_email
  ON product_inquiries(email_status,next_attempt_at,created_at);

CREATE TABLE IF NOT EXISTS product_inquiry_rate_limits (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts >= 1 AND attempts <= 5),
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
