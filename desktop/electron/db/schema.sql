-- Agents Manager local cache (better-sqlite3)
-- Idempotent: every CREATE uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS scans (
  id              TEXT PRIMARY KEY,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER NOT NULL,
  summary_json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id              TEXT PRIMARY KEY,
  agent_kind      TEXT NOT NULL,
  kind            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  model           TEXT,
  source_path     TEXT NOT NULL,
  raw_hash        TEXT NOT NULL,
  parsed_json     TEXT NOT NULL,
  last_seen_scan  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_agent_kind ON assets(agent_kind, kind);
CREATE INDEX IF NOT EXISTS idx_assets_last_scan ON assets(last_seen_scan);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id              TEXT PRIMARY KEY,
  agent_kind      TEXT NOT NULL,
  name            TEXT NOT NULL,
  command         TEXT,
  args_json       TEXT,
  env_json        TEXT,
  type            TEXT,
  url             TEXT,
  source_path     TEXT NOT NULL,
  last_seen_scan  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_agent_kind ON mcp_servers(agent_kind);

CREATE TABLE IF NOT EXISTS edits (
  id              TEXT PRIMARY KEY,
  asset_id        TEXT NOT NULL,
  before_hash     TEXT NOT NULL,
  after_hash      TEXT NOT NULL,
  backup_path     TEXT NOT NULL,
  edited_at       INTEGER NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_edits_asset ON edits(asset_id, edited_at DESC);

CREATE TABLE IF NOT EXISTS backend_config (
  id              INTEGER PRIMARY KEY CHECK(id = 1),
  url             TEXT,
  token           TEXT,
  machine_id      TEXT
);

CREATE TABLE IF NOT EXISTS snapshots_local (
  id              TEXT PRIMARY KEY,
  remote_id       TEXT,
  blob_id         TEXT,
  manifest_json   TEXT NOT NULL,
  pushed_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL
);
