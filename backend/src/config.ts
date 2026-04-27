export interface AppConfig {
  port: number
  host: string
  jwtSecret: string
  databaseUrl: string
  storageDriver: 'fs' | 's3'
  storageFsRoot: string
  allowRegistration: boolean
  maxBlobBytes: number
  corsOrigin: string | string[] | true
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback
  return /^(1|true|yes|on)$/i.test(v)
}

function parseInteger(v: string | undefined, fallback: number): number {
  if (!v) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function loadConfig(): AppConfig {
  const port = parseInteger(process.env.PORT, 8787)
  const host = process.env.HOST ?? '0.0.0.0'
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret || jwtSecret === 'change-me') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET must be set to a strong random value in production. Refusing to start.',
      )
    }
    console.warn('[config] using default insecure JWT secret — set JWT_SECRET in production')
  }
  return {
    port,
    host,
    jwtSecret: jwtSecret || 'dev-only-not-secure',
    databaseUrl: process.env.DATABASE_URL ?? 'sqlite:///data/app.db',
    storageDriver: (process.env.STORAGE_DRIVER as 'fs' | 's3') ?? 'fs',
    storageFsRoot: process.env.STORAGE_FS_ROOT ?? '/data/blobs',
    allowRegistration: parseBool(process.env.ALLOW_REGISTRATION, false),
    maxBlobBytes: parseInteger(process.env.MAX_BLOB_BYTES, 100 * 1024 * 1024),
    corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  }
}
