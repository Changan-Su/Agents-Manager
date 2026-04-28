import type { FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import type { AppConfig } from '../config'

declare module 'fastify' {
  interface FastifyRequest {
    machineId?: string
  }
}

const HEADER_API_KEY = 'x-api-key'
const HEADER_MACHINE_ID = 'x-machine-id'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function makeRequireApiKey(config: AppConfig) {
  return async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
    const provided = req.headers[HEADER_API_KEY]
    const key = Array.isArray(provided) ? provided[0] : provided
    if (!key || !safeEqual(key, config.apiKey)) {
      return reply.code(401).send({ error: 'invalid or missing X-Api-Key' })
    }
    const machineRaw = req.headers[HEADER_MACHINE_ID]
    const machineId = Array.isArray(machineRaw) ? machineRaw[0] : machineRaw
    if (!machineId || !/^[0-9a-zA-Z._-]{4,128}$/.test(machineId)) {
      return reply.code(400).send({ error: 'missing or invalid X-Machine-Id' })
    }
    req.machineId = machineId
  }
}
