import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth'
import {
  storeBlob,
  findBlob,
  readBlobData,
  deleteBlob,
} from '../services/blobService'
import type { StorageDriver } from '../storage'
import type { AppConfig } from '../config'

export async function blobRoutes(
  fastify: FastifyInstance,
  opts: { storage: StorageDriver; config: AppConfig },
) {
  const { storage, config } = opts

  // Upload a blob (multipart). Returns { blobId, sizeBytes, sha256 }.
  fastify.post('/blobs', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'no file in body' })

    const buffer = await data.toBuffer()
    if (buffer.length === 0) return reply.code(400).send({ error: 'empty blob' })
    if (buffer.length > config.maxBlobBytes) {
      return reply
        .code(413)
        .send({ error: `blob exceeds limit (${config.maxBlobBytes} bytes)` })
    }

    const blob = await storeBlob(storage, req.user.sub, buffer)
    return {
      blobId: blob.id,
      sizeBytes: blob.size_bytes,
      sha256: blob.sha256,
    }
  })

  fastify.get('/blobs/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { id } = req.params as { id: string }
    const blob = findBlob(id, req.user.sub)
    if (!blob) return reply.code(404).send({ error: 'blob not found' })
    const data = await readBlobData(storage, blob)
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('X-Blob-Sha256', blob.sha256)
      .header('Content-Length', String(blob.size_bytes))
    return reply.send(data)
  })

  fastify.delete('/blobs/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { id } = req.params as { id: string }
    const blob = findBlob(id, req.user.sub)
    if (!blob) return reply.code(404).send({ error: 'blob not found' })
    await deleteBlob(storage, blob)
    return { ok: true }
  })
}
