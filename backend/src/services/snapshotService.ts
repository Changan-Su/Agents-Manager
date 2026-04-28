import { randomUUID } from 'node:crypto'
import { getDb } from '../db/migrate'

export interface SnapshotRow {
  id: string
  machine_id: string
  blob_id: string
  manifest_json: string
  size_bytes: number
  created_at: number
}

export interface SnapshotManifest {
  agentInventory: Array<{
    kind: string
    counts: Record<string, number>
    version?: string
  }>
  encryption?: {
    algorithm: string
    kdf?: string
    saltB64?: string
  }
  clientVersion?: string
  createdAt: number
}

export function createSnapshot(params: {
  machineId: string
  blobId: string
  manifest: SnapshotManifest
  sizeBytes: number
}): SnapshotRow {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO snapshots (id, machine_id, blob_id, manifest_json, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      params.machineId,
      params.blobId,
      JSON.stringify(params.manifest),
      params.sizeBytes,
      now,
    )
  return {
    id,
    machine_id: params.machineId,
    blob_id: params.blobId,
    manifest_json: JSON.stringify(params.manifest),
    size_bytes: params.sizeBytes,
    created_at: now,
  }
}

export function listSnapshots(
  filter: { machineId?: string; limit?: number } = {},
): SnapshotRow[] {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500)
  if (filter.machineId) {
    return getDb()
      .prepare(
        `SELECT * FROM snapshots WHERE machine_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(filter.machineId, limit) as SnapshotRow[]
  }
  return getDb()
    .prepare(`SELECT * FROM snapshots ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as SnapshotRow[]
}

export function findSnapshot(snapshotId: string): SnapshotRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM snapshots WHERE id = ?`)
    .get(snapshotId) as SnapshotRow | undefined
  return row ?? null
}

export function deleteSnapshot(snapshotId: string): boolean {
  const r = getDb().prepare(`DELETE FROM snapshots WHERE id = ?`).run(snapshotId)
  return r.changes > 0
}

export function recordMachine(params: {
  machineId: string
  label: string
  os?: string
}): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    `INSERT INTO machines (machine_id, label, os, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(machine_id) DO UPDATE SET
       label = excluded.label,
       os = COALESCE(excluded.os, machines.os),
       last_seen_at = excluded.last_seen_at`,
  ).run(params.machineId, params.label, params.os ?? null, now, now)
}

export function listMachines(): Array<{
  machineId: string
  label: string
  os: string | null
  firstSeenAt: number
  lastSeenAt: number
}> {
  const rows = getDb()
    .prepare(
      `SELECT machine_id, label, os, first_seen_at, last_seen_at
       FROM machines ORDER BY last_seen_at DESC`,
    )
    .all() as Array<{
    machine_id: string
    label: string
    os: string | null
    first_seen_at: number
    last_seen_at: number
  }>
  return rows.map((r) => ({
    machineId: r.machine_id,
    label: r.label,
    os: r.os,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  }))
}
