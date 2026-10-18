CREATE TABLE tokenhub_audit_media (
  asset_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES tokenhub_audit_campaigns(id),
  slot INTEGER NOT NULL CHECK(slot BETWEEN 0 AND 13),
  case_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('image','video')),
  source_path TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_expires_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','archiving','archived','failed','expired','unsupported')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  next_attempt_at TEXT NOT NULL,
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes BETWEEN 0 AND 20971520),
  object_key TEXT,
  mime_type TEXT,
  size_bytes INTEGER CHECK(size_bytes BETWEEN 1 AND 20971520),
  sha256 TEXT,
  archived_at TEXT,
  error_code TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(campaign_id,slot,case_id) REFERENCES tokenhub_audit_cases(campaign_id,slot,case_id)
);
CREATE INDEX tokenhub_audit_media_case ON tokenhub_audit_media(campaign_id,slot,case_id);
