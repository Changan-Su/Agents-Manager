import Fastify from 'fastify'
import jwtPlugin from '@fastify/jwt'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { loadConfig } from './config'
import { openDatabase } from './db/migrate'
import { LocalFsStorage } from './storage/localFs'
import type { StorageDriver } from './storage'
import { authRoutes } from './routes/auth'
import { blobRoutes } from './routes/blobs'
import { snapshotRoutes } from './routes/snapshots'
import { healthRoutes } from './routes/health'

async function main() {
  const config = loadConfig()
  openDatabase(config.databaseUrl)

  let storage: StorageDriver
  if (config.storageDriver === 'fs') {
    storage = new LocalFsStorage(config.storageFsRoot)
  } else {
    throw new Error(`storage driver "${config.storageDriver}" not implemented yet`)
  }

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 1024 * 1024, // 1MB for JSON bodies; multipart has its own limit
  })

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: false,
  })
  await app.register(jwtPlugin, { secret: config.jwtSecret })
  await app.register(multipart, {
    limits: { fileSize: config.maxBlobBytes },
  })

  await app.register((instance) => healthRoutes(instance, { config }), { prefix: '/api' })
  await app.register((instance) => authRoutes(instance, { config }), { prefix: '/api' })
  await app.register((instance) => blobRoutes(instance, { storage, config }), { prefix: '/api' })
  await app.register(snapshotRoutes, { prefix: '/api' })

  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(`agents-manager backend listening on ${config.host}:${config.port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
