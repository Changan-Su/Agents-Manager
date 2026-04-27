import { createHash, randomUUID } from 'node:crypto'
import { getDb } from '../db/migrate'
import type { StorageDriver } from '../storage'

export interface BlobRow {
  id: string
  user_id: string
  storage_key: string
  size_bytes: number
  sha256: string
  created_at: number
}

export async function storeBlob(
  storage: StorageDriver,
  userId: string,
  data: Buffer,
): Promise<BlobRow> {
  const sha256 = createHash('sha256').update(data).digest('hex')
  const id = randomUUID()
  const storageKey = `${userId}/${id}.bin`
  await storage.put(storageKey, data)

  const row: BlobRow = {
    id,
    user_id: userId,
    storage_key: storageKey,
    size_bytes: data.length,
    sha256,
    created_at: Date.now(),
  }
  getDb()
    .prepare(
      `INSERT INTO blobs (id, user_id, storage_key, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.user_id, row.storage_key, row.size_bytes, row.sha256, row.created_at)
  return row
}

export function findBlob(blobId: string, userId: string): BlobRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM blobs WHERE id = ? AND user_id = ?`)
    .get(blobId, userId) as BlobRow | undefined
  return row ?? null
}

export async function readBlobData(storage: StorageDriver, row: BlobRow): Promise<Buffer> {
  return storage.get(row.storage_key)
}

export async function deleteBlob(storage: StorageDriver, row: BlobRow): Promise<void> {
  await storage.delete(row.storage_key)
  getDb().prepare(`DELETE FROM blobs WHERE id = ?`).run(row.id)
}
