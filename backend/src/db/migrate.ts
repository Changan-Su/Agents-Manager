import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let dbInstance: Database.Database | null = null

function resolveSqlitePath(databaseUrl: string): string {
  // Accept both `sqlite:///abs/path.db` and `/abs/path.db`
  if (databaseUrl.startsWith('sqlite:')) {
    return databaseUrl.replace(/^sqlite:\/\//, '')
  }
  return databaseUrl
}

export function openDatabase(databaseUrl: string): Database.Database {
  if (dbInstance) return dbInstance
  const path = resolveSqlitePath(databaseUrl)
  const dir = dirname(path)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  let schemaSql = ''
  const candidates = [join(__dirname, 'schema.sql'), join(__dirname, '..', 'db', 'schema.sql')]
  for (const c of candidates) {
    try {
      schemaSql = readFileSync(c, 'utf-8')
      break
    } catch {
      continue
    }
  }
  if (!schemaSql) schemaSql = INLINE_SCHEMA
  db.exec(schemaSql)

  dbInstance = db
  return db
}

export function getDb(): Database.Database {
  if (!dbInstance) throw new Error('Database not initialized')
  return dbInstance
}

const INLINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS machines (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, machine_id TEXT NOT NULL, label TEXT NOT NULL, os TEXT, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, UNIQUE(user_id, machine_id), FOREIGN KEY (user_id) REFERENCES users(id));
CREATE INDEX IF NOT EXISTS idx_machines_user ON machines(user_id);
CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, storage_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id));
CREATE INDEX IF NOT EXISTS idx_blobs_user ON blobs(user_id);
CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, machine_id TEXT NOT NULL, blob_id TEXT NOT NULL, manifest_json TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (blob_id) REFERENCES blobs(id));
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_machine ON snapshots(user_id, machine_id, created_at DESC);
`
