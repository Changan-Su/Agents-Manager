import { randomUUID } from 'node:crypto'
import { getDb } from '../db/migrate'

export interface SnapshotRow {
  id: string
  user_id: string
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
  userId: string
  machineId: string
  blobId: string
  manifest: SnapshotManifest
  sizeBytes: number
}): SnapshotRow {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO snapshots (id, user_id, machine_id, blob_id, manifest_json, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      params.userId,
      params.machineId,
      params.blobId,
      JSON.stringify(params.manifest),
      params.sizeBytes,
      now,
    )
  return {
    id,
    user_id: params.userId,
    machine_id: params.machineId,
    blob_id: params.blobId,
    manifest_json: JSON.stringify(params.manifest),
    size_bytes: params.sizeBytes,
    created_at: now,
  }
}

export function listSnapshots(
  userId: string,
  filter: { machineId?: string; limit?: number } = {},
): SnapshotRow[] {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500)
  if (filter.machineId) {
    return getDb()
      .prepare(
        `SELECT * FROM snapshots WHERE user_id = ? AND machine_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(userId, filter.machineId, limit) as SnapshotRow[]
  }
  return getDb()
    .prepare(`SELECT * FROM snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as SnapshotRow[]
}

export function findSnapshot(snapshotId: string, userId: string): SnapshotRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM snapshots WHERE id = ? AND user_id = ?`)
    .get(snapshotId, userId) as SnapshotRow | undefined
  return row ?? null
}

export function deleteSnapshot(snapshotId: string, userId: string): boolean {
  const r = getDb()
    .prepare(`DELETE FROM snapshots WHERE id = ? AND user_id = ?`)
    .run(snapshotId, userId)
  return r.changes > 0
}

export function recordMachine(params: {
  userId: string
  machineId: string
  label: string
  os?: string
}): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    `INSERT INTO machines (id, user_id, machine_id, label, os, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, machine_id) DO UPDATE SET
       label = excluded.label,
       os = COALESCE(excluded.os, machines.os),
       last_seen_at = excluded.last_seen_at`,
  ).run(randomUUID(), params.userId, params.machineId, params.label, params.os ?? null, now, now)
}

export function listMachines(userId: string): Array<{
  machineId: string
  label: string
  os: string | null
  firstSeenAt: number
  lastSeenAt: number
}> {
  const rows = getDb()
    .prepare(
      `SELECT machine_id, label, os, first_seen_at, last_seen_at
       FROM machines WHERE user_id = ? ORDER BY last_seen_at DESC`,
    )
    .all(userId) as Array<{
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
