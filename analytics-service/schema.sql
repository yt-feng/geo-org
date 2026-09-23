CREATE TABLE IF NOT EXISTS analytics_events (
 id TEXT PRIMARY KEY,
 timestamp INTEGER NOT NULL,
 day TEXT NOT NULL,
 name TEXT NOT NULL,
 path TEXT NOT NULL,
 session TEXT NOT NULL,
 source TEXT NOT NULL,
 referrer TEXT NOT NULL,
 lang TEXT NOT NULL,
 device TEXT NOT NULL,
 target TEXT NOT NULL,
 value INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS analytics_events_day_name ON analytics_events(day,name);
CREATE INDEX IF NOT EXISTS analytics_events_timestamp ON analytics_events(timestamp);
CREATE TABLE IF NOT EXISTS analytics_sessions (
 token_hash TEXT PRIMARY KEY,
 expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS analytics_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires INTEGER NOT NULL
);
