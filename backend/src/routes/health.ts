import type { FastifyInstance } from 'fastify'
import { getDb } from '../db/migrate'
import type { AppConfig } from '../config'

export async function healthRoutes(fastify: FastifyInstance, opts: { config: AppConfig }) {
  const { config } = opts
  fastify.get('/health', async () => {
    let users = -1
    let snapshots = -1
    try {
      users = (getDb().prepare(`SELECT COUNT(*) as n FROM users`).get() as { n: number }).n
      snapshots = (getDb().prepare(`SELECT COUNT(*) as n FROM snapshots`).get() as { n: number })
        .n
    } catch {
      // db not ready; report degraded
    }
    return {
      ok: users >= 0,
      version: '0.1.0',
      storage: config.storageDriver,
      users,
      snapshots,
    }
  })
}
