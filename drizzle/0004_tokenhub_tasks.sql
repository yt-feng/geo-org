CREATE TABLE tokenhub_requests (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE tokenhub_tasks (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX tokenhub_tasks_user_created ON tokenhub_tasks(user_id, created_at);
