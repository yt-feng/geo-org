CREATE TABLE local_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL CHECK(length(password_salt) = 64),
  password_hash TEXT NOT NULL CHECK(length(password_hash) = 64),
  password_iterations INTEGER NOT NULL CHECK(password_iterations = 100000),
  password_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256' CHECK(password_algorithm = 'PBKDF2-SHA256'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(email = lower(trim(email)))
);

-- Preserve existing legacy email ownership, including differing letter case.
-- The trigger runs inside the same D1 transaction as credential creation.
CREATE TRIGGER local_auth_user_email_guard
BEFORE INSERT ON users
WHEN substr(NEW.id, 1, 6) = 'local_'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM users WHERE id != NEW.id AND lower(trim(email)) = lower(trim(NEW.email))
  ) THEN RAISE(ABORT, 'LOCAL_AUTH_EMAIL_EXISTS') END;
END;

CREATE TRIGGER local_auth_user_email_update_guard
BEFORE UPDATE OF email ON users
WHEN EXISTS (SELECT 1 FROM local_credentials WHERE user_id = OLD.id)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM local_credentials WHERE user_id = OLD.id AND email = NEW.email
  ) THEN RAISE(ABORT, 'LOCAL_AUTH_EMAIL_IMMUTABLE') END;
END;

CREATE TRIGGER local_auth_credential_guard
BEFORE INSERT ON local_credentials
BEGIN
  SELECT CASE WHEN substr(NEW.user_id, 1, 6) != 'local_' OR NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id AND email = NEW.email AND status = 'active'
  ) THEN RAISE(ABORT, 'LOCAL_AUTH_USER_INVALID') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM users
    WHERE id != NEW.user_id AND lower(trim(email)) = NEW.email
  ) THEN RAISE(ABORT, 'LOCAL_AUTH_EMAIL_EXISTS') END;
END;

CREATE TABLE local_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES local_credentials(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK(expires_at > created_at)
);
CREATE INDEX local_sessions_user_idx ON local_sessions(user_id);
CREATE INDEX local_sessions_expiry_idx ON local_sessions(expires_at);
