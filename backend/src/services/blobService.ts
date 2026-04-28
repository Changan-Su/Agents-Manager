import { createHash, randomUUID } from 'node:crypto'
import { getDb } from '../db/migrate'
import type { StorageDriver } from '../storage'

export interface BlobRow {
  id: string
  machine_id: string
  storage_key: string
  size_bytes: number
  sha256: string
  created_at: number
}

export async function storeBlob(
  storage: StorageDriver,
  machineId: string,
  data: Buffer,
): Promise<BlobRow> {
  const sha256 = createHash('sha256').update(data).digest('hex')
  const id = randomUUID()
  const storageKey = `${machineId}/${id}.bin`
  await storage.put(storageKey, data)

  const row: BlobRow = {
    id,
    machine_id: machineId,
    storage_key: storageKey,
    size_bytes: data.length,
    sha256,
    created_at: Date.now(),
  }
  getDb()
    .prepare(
      `INSERT INTO blobs (id, machine_id, storage_key, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.machine_id, row.storage_key, row.size_bytes, row.sha256, row.created_at)
  return row
}

export function findBlob(blobId: string, machineId: string): BlobRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM blobs WHERE id = ? AND machine_id = ?`)
    .get(blobId, machineId) as BlobRow | undefined
  return row ?? null
}

export function findBlobAnyMachine(blobId: string): BlobRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM blobs WHERE id = ?`)
    .get(blobId) as BlobRow | undefined
  return row ?? null
}

export async function readBlobData(storage: StorageDriver, row: BlobRow): Promise<Buffer> {
  return storage.get(row.storage_key)
}

export async function deleteBlob(storage: StorageDriver, row: BlobRow): Promise<void> {
  await storage.delete(row.storage_key)
  getDb().prepare(`DELETE FROM blobs WHERE id = ?`).run(row.id)
}
