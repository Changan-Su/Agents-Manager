import type { FastifyInstance } from 'fastify'
import { getDb } from '../db/migrate'
import type { AppConfig } from '../config'

export async function healthRoutes(fastify: FastifyInstance, opts: { config: AppConfig }) {
  const { config } = opts
  fastify.get('/health', async () => {
    let machines = -1
    let snapshots = -1
    try {
      machines = (getDb().prepare(`SELECT COUNT(*) as n FROM machines`).get() as { n: number }).n
      snapshots = (getDb().prepare(`SELECT COUNT(*) as n FROM snapshots`).get() as { n: number }).n
    } catch {
      // db not ready; report degraded
    }
    return {
      ok: machines >= 0,
      version: '0.4.0',
      auth: 'api-key',
      storage: config.storageDriver,
      machines,
      snapshots,
    }
  })
}
