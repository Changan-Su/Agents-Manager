export interface AppConfig {
  port: number
  host: string
  apiKey: string
  databaseUrl: string
  storageDriver: 'fs' | 's3'
  storageFsRoot: string
  maxBlobBytes: number
  corsOrigin: string | string[] | true
}

function parseInteger(v: string | undefined, fallback: number): number {
  if (!v) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function loadConfig(): AppConfig {
  const port = parseInteger(process.env.PORT, 8787)
  const host = process.env.HOST ?? '0.0.0.0'

  const apiKey = process.env.AGENTS_MANAGER_API_KEY ?? ''
  if (!apiKey || apiKey.length < 32) {
    throw new Error(
      'AGENTS_MANAGER_API_KEY must be set to a strong random value (≥32 chars). ' +
        'Generate one with: openssl rand -base64 48',
    )
  }

  return {
    port,
    host,
    apiKey,
    databaseUrl: process.env.DATABASE_URL ?? 'sqlite:///data/app.db',
    storageDriver: (process.env.STORAGE_DRIVER as 'fs' | 's3') ?? 'fs',
    storageFsRoot: process.env.STORAGE_FS_ROOT ?? '/data/blobs',
    maxBlobBytes: parseInteger(process.env.MAX_BLOB_BYTES, 100 * 1024 * 1024),
    corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  }
}
