CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user',
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS machines (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  machine_id      TEXT NOT NULL,
  label           TEXT NOT NULL,
  os              TEXT,
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  UNIQUE(user_id, machine_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_machines_user ON machines(user_id);

CREATE TABLE IF NOT EXISTS blobs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  storage_key     TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_blobs_user ON blobs(user_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  machine_id      TEXT NOT NULL,
  blob_id         TEXT NOT NULL,
  manifest_json   TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (blob_id) REFERENCES blobs(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_machine ON snapshots(user_id, machine_id, created_at DESC);
