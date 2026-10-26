ALTER TABLE tokenhub_billing ADD COLUMN poll_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tokenhub_billing ADD COLUMN next_poll_at TEXT;
ALTER TABLE tokenhub_billing ADD COLUMN last_polled_at TEXT;
CREATE INDEX IF NOT EXISTS tokenhub_billing_poll ON tokenhub_billing(next_poll_at, poll_count);
