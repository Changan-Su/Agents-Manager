-- Agents Manager backend (better-sqlite3)
-- v0.4: Master-key auth — single tenant, namespaced by machine_id only.
-- No users table; no JWTs. The API key in env grants access; the X-Machine-Id
-- header partitions data so multiple devices can co-exist on one server.

CREATE TABLE IF NOT EXISTS machines (
  machine_id      TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  os              TEXT,
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
  id              TEXT PRIMARY KEY,
  machine_id      TEXT NOT NULL,
  storage_key     TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blobs_machine ON blobs(machine_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id              TEXT PRIMARY KEY,
  machine_id      TEXT NOT NULL,
  blob_id         TEXT NOT NULL,
  manifest_json   TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (blob_id) REFERENCES blobs(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_machine ON snapshots(machine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS repository_items (
  id              TEXT PRIMARY KEY,
  machine_id      TEXT NOT NULL,
  kind            TEXT NOT NULL,
  name            TEXT NOT NULL,
  version         TEXT,
  blob_id         TEXT NOT NULL,
  manifest_json   TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (blob_id) REFERENCES blobs(id)
);

CREATE INDEX IF NOT EXISTS idx_repo_machine_kind ON repository_items(machine_id, kind);

-- Legacy tables (users) intentionally not created. If migrating from <=v0.3,
-- drop the old DB and start fresh — the master-key model has no concept of
-- per-user ownership.
