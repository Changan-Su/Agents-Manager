import { randomUUID } from 'node:crypto'
import { getDb } from '../db/migrate'

export interface RepositoryRow {
  id: string
  machine_id: string
  kind: string
  name: string
  version: string | null
  blob_id: string
  manifest_json: string
  created_at: number
  updated_at: number
}

export interface RepositoryManifest {
  files: Array<{ archivePath: string; sizeBytes: number; mode?: number }>
  description?: string
  encryption?: { algorithm: string; kdf?: string; saltB64?: string }
  clientVersion?: string
}

export function upsertItem(params: {
  id?: string
  machineId: string
  kind: string
  name: string
  version?: string
  blobId: string
  manifest: RepositoryManifest
}): RepositoryRow {
  const db = getDb()
  const now = Date.now()
  const id = params.id ?? randomUUID()
  const existing = db
    .prepare(`SELECT * FROM repository_items WHERE id = ?`)
    .get(id) as RepositoryRow | undefined

  if (existing) {
    db.prepare(
      `UPDATE repository_items SET kind=?, name=?, version=?, blob_id=?, manifest_json=?, updated_at=?
       WHERE id = ? AND machine_id = ?`,
    ).run(
      params.kind,
      params.name,
      params.version ?? null,
      params.blobId,
      JSON.stringify(params.manifest),
      now,
      id,
      params.machineId,
    )
  } else {
    db.prepare(
      `INSERT INTO repository_items (id, machine_id, kind, name, version, blob_id, manifest_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      params.machineId,
      params.kind,
      params.name,
      params.version ?? null,
      params.blobId,
      JSON.stringify(params.manifest),
      now,
      now,
    )
  }

  return {
    id,
    machine_id: params.machineId,
    kind: params.kind,
    name: params.name,
    version: params.version ?? null,
    blob_id: params.blobId,
    manifest_json: JSON.stringify(params.manifest),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  }
}

export function listItems(machineId: string, kind?: string): RepositoryRow[] {
  const db = getDb()
  if (kind) {
    return db
      .prepare(
        `SELECT * FROM repository_items WHERE machine_id = ? AND kind = ?
         ORDER BY name ASC`,
      )
      .all(machineId, kind) as RepositoryRow[]
  }
  return db
    .prepare(`SELECT * FROM repository_items WHERE machine_id = ? ORDER BY kind, name`)
    .all(machineId) as RepositoryRow[]
}

export function findItem(id: string, machineId: string): RepositoryRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM repository_items WHERE id = ? AND machine_id = ?`)
    .get(id, machineId) as RepositoryRow | undefined
  return row ?? null
}

export function deleteItem(id: string, machineId: string): boolean {
  const r = getDb()
    .prepare(`DELETE FROM repository_items WHERE id = ? AND machine_id = ?`)
    .run(id, machineId)
  return r.changes > 0
}
