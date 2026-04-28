import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { loadConfig } from './config'
import { openDatabase } from './db/migrate'
import { LocalFsStorage } from './storage/localFs'
import type { StorageDriver } from './storage'
import { blobRoutes } from './routes/blobs'
import { snapshotRoutes } from './routes/snapshots'
import { repositoryRoutes } from './routes/repository'
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
    bodyLimit: 1024 * 1024,
  })

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: false,
    // Electron and browser clients need these custom headers passed through.
    allowedHeaders: ['Content-Type', 'X-Api-Key', 'X-Machine-Id'],
    exposedHeaders: ['X-Blob-Sha256'],
  })
  await app.register(multipart, {
    limits: { fileSize: config.maxBlobBytes },
  })

  await app.register((instance) => healthRoutes(instance, { config }), { prefix: '/api' })
  await app.register((instance) => blobRoutes(instance, { storage, config }), { prefix: '/api' })
  await app.register((instance) => snapshotRoutes(instance, { config }), { prefix: '/api' })
  await app.register((instance) => repositoryRoutes(instance, { config }), { prefix: '/api' })

  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(
      `agents-manager backend listening on ${config.host}:${config.port} (master-key auth)`,
    )
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
