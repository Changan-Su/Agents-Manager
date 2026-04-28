import type Database from 'better-sqlite3'
import type {
  Asset,
  McpServer,
  AgentSummary,
  RepositoryItem,
  RepositoryKind,
} from '../../../shared/types'
import { getDatabase } from './migrate'

export function recordScan(
  scanId: string,
  startedAt: number,
  finishedAt: number,
  summary: AgentSummary[],
): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO scans (id, started_at, finished_at, summary_json) VALUES (?, ?, ?, ?)`,
  ).run(scanId, startedAt, finishedAt, JSON.stringify(summary))
}

export function upsertAssets(assets: Asset[], scanId: string): void {
  if (assets.length === 0) return
  const db = getDatabase()
  const stmt = db.prepare(
    `INSERT INTO assets (id, agent_kind, kind, name, description, model, source_path, raw_hash, parsed_json, last_seen_scan)
     VALUES (@id, @agentKind, @kind, @name, @description, @model, @sourcePath, @rawHash, @parsedJson, @scanId)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,
       description=excluded.description,
       model=excluded.model,
       source_path=excluded.source_path,
       raw_hash=excluded.raw_hash,
       parsed_json=excluded.parsed_json,
       last_seen_scan=excluded.last_seen_scan`,
  )
  const tx = db.transaction((items: Asset[]) => {
    for (const a of items) {
      stmt.run({
        id: a.id,
        agentKind: a.agentKind,
        kind: a.kind,
        name: a.name,
        description: a.description ?? null,
        model: a.model ?? null,
        sourcePath: a.sourcePath,
        rawHash: a.rawHash,
        parsedJson: JSON.stringify(a.parsed),
        scanId,
      })
    }
  })
  tx(assets)
}

export function upsertMcpServers(servers: McpServer[], scanId: string): void {
  if (servers.length === 0) return
  const db = getDatabase()
  const stmt = db.prepare(
    `INSERT INTO mcp_servers (id, agent_kind, name, command, args_json, env_json, type, url, source_path, last_seen_scan)
     VALUES (@id, @agentKind, @name, @command, @args, @env, @type, @url, @sourcePath, @scanId)
     ON CONFLICT(id) DO UPDATE SET
       command=excluded.command,
       args_json=excluded.args_json,
       env_json=excluded.env_json,
       type=excluded.type,
       url=excluded.url,
       source_path=excluded.source_path,
       last_seen_scan=excluded.last_seen_scan`,
  )
  const tx = db.transaction((items: McpServer[]) => {
    for (const m of items) {
      const id = `mcp:${m.agentKind}:${m.name}`
      stmt.run({
        id,
        agentKind: m.agentKind,
        name: m.name,
        command: m.command ?? null,
        args: m.args ? JSON.stringify(m.args) : null,
        env: m.env ? JSON.stringify(m.env) : null,
        type: m.type ?? null,
        url: m.url ?? null,
        sourcePath: m.sourcePath,
        scanId,
      })
    }
  })
  tx(servers)
}

export function findAssetById(id: string): Asset | null {
  const db = getDatabase()
  const row = db
    .prepare(
      `SELECT id, agent_kind, kind, name, description, model, source_path, raw_hash, parsed_json
       FROM assets WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string
        agent_kind: string
        kind: string
        name: string
        description: string | null
        model: string | null
        source_path: string
        raw_hash: string
        parsed_json: string
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    agentKind: row.agent_kind as Asset['agentKind'],
    kind: row.kind as Asset['kind'],
    name: row.name,
    description: row.description ?? undefined,
    model: row.model ?? undefined,
    sourcePath: row.source_path,
    rawHash: row.raw_hash,
    parsed: JSON.parse(row.parsed_json),
  }
}

export function listAssetsByAgentAndKind(
  agentKind: string,
  kind?: string,
): Asset[] {
  const db = getDatabase()
  const rows = (
    kind
      ? db
          .prepare(
            `SELECT id, agent_kind, kind, name, description, model, source_path, raw_hash, parsed_json
             FROM assets WHERE agent_kind = ? AND kind = ? ORDER BY name`,
          )
          .all(agentKind, kind)
      : db
          .prepare(
            `SELECT id, agent_kind, kind, name, description, model, source_path, raw_hash, parsed_json
             FROM assets WHERE agent_kind = ? ORDER BY kind, name`,
          )
          .all(agentKind)
  ) as Array<{
    id: string
    agent_kind: string
    kind: string
    name: string
    description: string | null
    model: string | null
    source_path: string
    raw_hash: string
    parsed_json: string
  }>

  return rows.map((row) => ({
    id: row.id,
    agentKind: row.agent_kind as Asset['agentKind'],
    kind: row.kind as Asset['kind'],
    name: row.name,
    description: row.description ?? undefined,
    model: row.model ?? undefined,
    sourcePath: row.source_path,
    rawHash: row.raw_hash,
    parsed: JSON.parse(row.parsed_json),
  }))
}

export function listMcpServers(agentKind?: string): McpServer[] {
  const db = getDatabase()
  const rows = (
    agentKind
      ? db.prepare(`SELECT * FROM mcp_servers WHERE agent_kind = ? ORDER BY name`).all(agentKind)
      : db.prepare(`SELECT * FROM mcp_servers ORDER BY agent_kind, name`).all()
  ) as Array<{
    agent_kind: string
    name: string
    command: string | null
    args_json: string | null
    env_json: string | null
    type: string | null
    url: string | null
    source_path: string
  }>

  return rows.map((row) => ({
    agentKind: row.agent_kind as McpServer['agentKind'],
    name: row.name,
    command: row.command ?? undefined,
    args: row.args_json ? JSON.parse(row.args_json) : undefined,
    env: row.env_json ? JSON.parse(row.env_json) : undefined,
    type: (row.type ?? undefined) as McpServer['type'],
    url: row.url ?? undefined,
    sourcePath: row.source_path,
  }))
}

export function getLatestScanSummary(): AgentSummary[] | null {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT summary_json FROM scans ORDER BY finished_at DESC LIMIT 1`)
    .get() as { summary_json: string } | undefined
  return row ? (JSON.parse(row.summary_json) as AgentSummary[]) : null
}

export function recordEdit(
  id: string,
  assetId: string,
  beforeHash: string,
  afterHash: string,
  backupPath: string,
): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO edits (id, asset_id, before_hash, after_hash, backup_path, edited_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, assetId, beforeHash, afterHash, backupPath, Date.now())
}

export interface EditRow {
  id: string
  assetId: string
  beforeHash: string
  afterHash: string
  backupPath: string
  editedAt: number
}

export function listEdits(assetId: string): EditRow[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT id, asset_id, before_hash, after_hash, backup_path, edited_at
       FROM edits WHERE asset_id = ? ORDER BY edited_at DESC`,
    )
    .all(assetId) as Array<{
    id: string
    asset_id: string
    before_hash: string
    after_hash: string
    backup_path: string
    edited_at: number
  }>
  return rows.map((r) => ({
    id: r.id,
    assetId: r.asset_id,
    beforeHash: r.before_hash,
    afterHash: r.after_hash,
    backupPath: r.backup_path,
    editedAt: r.edited_at,
  }))
}

export function updateAssetHashAfterEdit(
  assetId: string,
  newHash: string,
): void {
  const db = getDatabase()
  db.prepare(`UPDATE assets SET raw_hash = ? WHERE id = ?`).run(newHash, assetId)
}

export function getSetting(key: string): string | null {
  const db = getDatabase()
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

// ── Repository ────────────────────────────────────────────────────────────

interface RepoRow {
  id: string
  kind: string
  name: string
  version: string | null
  description: string | null
  storage_path: string
  manifest_json: string
  deployed_to_json: string
  remote_id: string | null
  created_at: number
  updated_at: number
}

function toRepoItem(r: RepoRow): RepositoryItem {
  return {
    id: r.id,
    kind: r.kind as RepositoryKind,
    name: r.name,
    version: r.version ?? undefined,
    description: r.description ?? undefined,
    storagePath: r.storage_path,
    manifest: JSON.parse(r.manifest_json),
    deployedTo: JSON.parse(r.deployed_to_json),
    remoteId: r.remote_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function repoInsert(item: RepositoryItem): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO repository_items
       (id, kind, name, version, description, storage_path, manifest_json,
        deployed_to_json, remote_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    item.kind,
    item.name,
    item.version ?? null,
    item.description ?? null,
    item.storagePath,
    JSON.stringify(item.manifest),
    JSON.stringify(item.deployedTo),
    item.remoteId ?? null,
    item.createdAt,
    item.updatedAt,
  )
}

export function repoUpdate(item: RepositoryItem): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE repository_items
       SET kind=?, name=?, version=?, description=?, storage_path=?,
           manifest_json=?, deployed_to_json=?, remote_id=?, updated_at=?
     WHERE id=?`,
  ).run(
    item.kind,
    item.name,
    item.version ?? null,
    item.description ?? null,
    item.storagePath,
    JSON.stringify(item.manifest),
    JSON.stringify(item.deployedTo),
    item.remoteId ?? null,
    item.updatedAt,
    item.id,
  )
}

export function repoFind(id: string): RepositoryItem | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM repository_items WHERE id = ?`)
    .get(id) as RepoRow | undefined
  return row ? toRepoItem(row) : null
}

export function repoList(kind?: RepositoryKind): RepositoryItem[] {
  const db = getDatabase()
  const rows = (
    kind
      ? db.prepare(`SELECT * FROM repository_items WHERE kind = ? ORDER BY name`).all(kind)
      : db.prepare(`SELECT * FROM repository_items ORDER BY kind, name`).all()
  ) as RepoRow[]
  return rows.map(toRepoItem)
}

export function repoDelete(id: string): boolean {
  const r = getDatabase().prepare(`DELETE FROM repository_items WHERE id = ?`).run(id)
  return r.changes > 0
}

// keep the type import non-erased
void ({} as Database.Database)
