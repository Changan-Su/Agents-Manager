import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth'
import {
  createSnapshot,
  deleteSnapshot,
  findSnapshot,
  listMachines,
  listSnapshots,
  recordMachine,
} from '../services/snapshotService'
import { findBlob } from '../services/blobService'

interface CreateSnapshotBody {
  blobId: string
  machineId: string
  machineLabel: string
  os?: string
  manifest: {
    agentInventory: Array<{ kind: string; counts: Record<string, number>; version?: string }>
    encryption?: { algorithm: string; kdf?: string; saltB64?: string }
    clientVersion?: string
    createdAt: number
  }
  sizeBytes: number
}

export async function snapshotRoutes(fastify: FastifyInstance) {
  fastify.post('/snapshots', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const body = (req.body ?? {}) as Partial<CreateSnapshotBody>
    if (!body.blobId || !body.machineId || !body.machineLabel || !body.manifest) {
      return reply.code(400).send({ error: 'blobId, machineId, machineLabel, manifest are required' })
    }
    // ensure blob exists & belongs to caller
    const blob = findBlob(body.blobId, req.user.sub)
    if (!blob) return reply.code(404).send({ error: 'blob not found' })

    recordMachine({
      userId: req.user.sub,
      machineId: body.machineId,
      label: body.machineLabel,
      os: body.os,
    })

    const snap = createSnapshot({
      userId: req.user.sub,
      machineId: body.machineId,
      blobId: body.blobId,
      manifest: body.manifest,
      sizeBytes: body.sizeBytes ?? blob.size_bytes,
    })
    return {
      id: snap.id,
      machineId: snap.machine_id,
      blobId: snap.blob_id,
      sizeBytes: snap.size_bytes,
      createdAt: snap.created_at,
    }
  })

  fastify.get('/snapshots', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { machineId, limit } = req.query as { machineId?: string; limit?: string }
    const rows = listSnapshots(req.user.sub, {
      machineId,
      limit: limit ? Number(limit) : undefined,
    })
    return {
      snapshots: rows.map((r) => ({
        id: r.id,
        machineId: r.machine_id,
        blobId: r.blob_id,
        manifest: JSON.parse(r.manifest_json),
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
      })),
    }
  })

  fastify.get('/snapshots/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { id } = req.params as { id: string }
    const snap = findSnapshot(id, req.user.sub)
    if (!snap) return reply.code(404).send({ error: 'snapshot not found' })
    return {
      id: snap.id,
      machineId: snap.machine_id,
      blobId: snap.blob_id,
      manifest: JSON.parse(snap.manifest_json),
      sizeBytes: snap.size_bytes,
      createdAt: snap.created_at,
    }
  })

  fastify.delete('/snapshots/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    const { id } = req.params as { id: string }
    if (!deleteSnapshot(id, req.user.sub)) {
      return reply.code(404).send({ error: 'snapshot not found' })
    }
    return { ok: true }
  })

  fastify.get('/machines', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    return { machines: listMachines(req.user.sub) }
  })
}
