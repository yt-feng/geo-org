-- Only a successfully verified recovery hash can create a short-lived grant.
-- No plaintext email, password, recovery link, or provider token is stored.
CREATE TABLE auth_password_recovery (
  id TEXT PRIMARY KEY NOT NULL,
  provider_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ready','processing','completed','unknown','expired')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_password_recovery_expiry ON auth_password_recovery(expires_at);

CREATE TABLE auth_recovery_email_limits (
  id TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  expires_at INTEGER NOT NULL
);
