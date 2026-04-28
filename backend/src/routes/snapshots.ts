import type { FastifyInstance } from 'fastify'
import { makeRequireApiKey } from '../middleware/auth'
import {
  createSnapshot,
  deleteSnapshot,
  findSnapshot,
  listMachines,
  listSnapshots,
  recordMachine,
} from '../services/snapshotService'
import { findBlob } from '../services/blobService'
import type { AppConfig } from '../config'

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

export async function snapshotRoutes(
  fastify: FastifyInstance,
  opts: { config: AppConfig },
) {
  const requireApiKey = makeRequireApiKey(opts.config)

  fastify.post('/snapshots', { preHandler: [requireApiKey] }, async (req, reply) => {
    const machineId = req.machineId!
    const body = (req.body ?? {}) as Partial<CreateSnapshotBody>
    if (!body.blobId || !body.machineLabel || !body.manifest) {
      return reply.code(400).send({ error: 'blobId, machineLabel, manifest are required' })
    }
    // The body may carry its own machineId, but the auth-bound one wins to
    // prevent a client from impersonating another machine after they
    // authenticate.
    const blob = findBlob(body.blobId, machineId)
    if (!blob) return reply.code(404).send({ error: 'blob not found' })

    recordMachine({
      machineId,
      label: body.machineLabel,
      os: body.os,
    })

    const snap = createSnapshot({
      machineId,
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

  fastify.get('/snapshots', { preHandler: [requireApiKey] }, async (req) => {
    const { machineId, limit } = req.query as { machineId?: string; limit?: string }
    const rows = listSnapshots({
      machineId: machineId ?? req.machineId,
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

  fastify.get('/snapshots/:id', { preHandler: [requireApiKey] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const snap = findSnapshot(id)
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

  fastify.delete('/snapshots/:id', { preHandler: [requireApiKey] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!deleteSnapshot(id)) {
      return reply.code(404).send({ error: 'snapshot not found' })
    }
    return { ok: true }
  })

  fastify.get('/machines', { preHandler: [requireApiKey] }, async () => {
    return { machines: listMachines() }
  })
}
