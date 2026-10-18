CREATE TABLE tokenhub_audit_catalog_snapshots (
  campaign_id TEXT NOT NULL REFERENCES tokenhub_audit_campaigns(id),
  day INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
  state TEXT NOT NULL CHECK (state IN ('fetching','succeeded','partial','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 8),
  next_attempt_at TEXT NOT NULL,
  models_json TEXT,
  models_hash TEXT,
  pricing_json TEXT,
  pricing_hash TEXT,
  catalog_json TEXT NOT NULL DEFAULT '[]',
  error_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, day)
);
