import type { FastifyInstance } from 'fastify'
import { makeRequireApiKey } from '../middleware/auth'
import {
  deleteItem,
  findItem,
  listItems,
  upsertItem,
  type RepositoryManifest,
} from '../services/repositoryService'
import { findBlob } from '../services/blobService'
import type { AppConfig } from '../config'

interface UpsertBody {
  id?: string
  kind: string
  name: string
  version?: string
  blobId: string
  manifest: RepositoryManifest
}

export async function repositoryRoutes(
  fastify: FastifyInstance,
  opts: { config: AppConfig },
) {
  const requireApiKey = makeRequireApiKey(opts.config)

  fastify.get('/repository', { preHandler: [requireApiKey] }, async (req) => {
    const machineId = req.machineId!
    const { kind } = req.query as { kind?: string }
    const rows = listItems(machineId, kind)
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        version: r.version,
        blobId: r.blob_id,
        manifest: JSON.parse(r.manifest_json),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    }
  })

  fastify.post('/repository', { preHandler: [requireApiKey] }, async (req, reply) => {
    const machineId = req.machineId!
    const body = (req.body ?? {}) as Partial<UpsertBody>
    if (!body.kind || !body.name || !body.blobId || !body.manifest) {
      return reply
        .code(400)
        .send({ error: 'kind, name, blobId, manifest are required' })
    }
    const blob = findBlob(body.blobId, machineId)
    if (!blob) return reply.code(404).send({ error: 'blob not found' })

    const row = upsertItem({
      id: body.id,
      machineId,
      kind: body.kind,
      name: body.name,
      version: body.version,
      blobId: body.blobId,
      manifest: body.manifest,
    })
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      version: row.version,
      blobId: row.blob_id,
      manifest: JSON.parse(row.manifest_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })

  fastify.get('/repository/:id', { preHandler: [requireApiKey] }, async (req, reply) => {
    const machineId = req.machineId!
    const { id } = req.params as { id: string }
    const row = findItem(id, machineId)
    if (!row) return reply.code(404).send({ error: 'repository item not found' })
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      version: row.version,
      blobId: row.blob_id,
      manifest: JSON.parse(row.manifest_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })

  fastify.delete('/repository/:id', { preHandler: [requireApiKey] }, async (req, reply) => {
    const machineId = req.machineId!
    const { id } = req.params as { id: string }
    if (!deleteItem(id, machineId)) {
      return reply.code(404).send({ error: 'repository item not found' })
    }
    return { ok: true }
  })
}
