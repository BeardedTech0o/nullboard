-- nullboard 0001: initial schema.
-- Applied once by `wrangler d1 migrations apply`, which records each file in
-- the d1_migrations table and never re-runs it. Every statement is also
-- guarded with IF NOT EXISTS so an accidental replay changes nothing and
-- touches no rows. Tables are prefixed nb_ because nullobj-db is shared.

CREATE TABLE IF NOT EXISTS nb_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret_enc TEXT NOT NULL,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  session_version INTEGER NOT NULL DEFAULT 1,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nb_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES nb_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nb_recovery_user_hash
  ON nb_recovery_codes(user_id, code_hash);

CREATE TABLE IF NOT EXISTS nb_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES nb_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nb_reset_user ON nb_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS nb_auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nb_attempts_bucket
  ON nb_auth_attempts(bucket, created_at);

-- One row per synced record. kind is one of project, tile, template, day,
-- prefs. data is a JSON document. updated_at is the (server-calibrated)
-- client edit time used for last-write-wins. seq is a per-user counter that
-- lets a device ask for "everything since I last looked".
CREATE TABLE IF NOT EXISTS nb_records (
  user_id TEXT NOT NULL REFERENCES nb_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_nb_records_seq ON nb_records(user_id, seq);
