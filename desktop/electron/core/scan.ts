import { randomUUID } from 'node:crypto'
import { adapters } from '../scanner/registry'
import type { ScanContext } from '../scanner/AgentAdapter'
import type {
  AgentSummary,
  McpServer,
  ScanResult,
} from '../../../shared/types'

export interface RunScanOptions {
  /** Override home directory; defaults to OS homedir via adapters. */
  homeDir?: string
  /** Optional scan id (caller supplies one when correlating with persistence). */
  scanId?: string
}

export interface RunScanResult {
  scanId: string
  startedAt: number
  finishedAt: number
  summary: AgentSummary[]
  /** Full per-adapter result; consumers (IPC) use this to persist assets. */
  perAgent: ScanResult[]
}

/**
 * Pure scan core — runs every registered adapter against the given context and
 * returns a summary plus the raw per-adapter results. No persistence, no IPC.
 * Both the Electron IPC handler and the CLI entry are built on top of this.
 */
export async function runScan(options: RunScanOptions = {}): Promise<RunScanResult> {
  const startedAt = Date.now()
  const scanId = options.scanId ?? randomUUID()
  const ctx: ScanContext | undefined = options.homeDir
    ? { homeDir: options.homeDir }
    : undefined

  const summary: AgentSummary[] = []
  const perAgent: ScanResult[] = []

  for (const adapter of adapters) {
    const detection = await adapter.detect(ctx)
    if (!detection.present) {
      summary.push({
        kind: adapter.kind,
        present: false,
        root: detection.root,
        counts: {
          agents: 0,
          skills: 0,
          plugins: 0,
          commands: 0,
          hooks: 0,
          mcpServers: 0,
        },
        errors: [],
      })
      perAgent.push({
        detection,
        agents: [],
        skills: [],
        plugins: [],
        commands: [],
        hooks: [],
        mcpServers: [],
        settings: null,
        errors: [],
      })
      continue
    }

    const result = await adapter.scan(detection, ctx)
    perAgent.push(result)
    summary.push({
      kind: adapter.kind,
      present: true,
      root: detection.root,
      counts: {
        agents: result.agents.length,
        skills: result.skills.length,
        plugins: result.plugins.length,
        commands: result.commands.length,
        hooks: result.hooks.length,
        mcpServers: result.mcpServers.length,
      },
      errors: result.errors,
    })
  }

  return {
    scanId,
    startedAt,
    finishedAt: Date.now(),
    summary,
    perAgent,
  }
}

// ── secret redaction ──────────────────────────────────────────────────────

const REDACTED_VALUE = '***redacted***'
const SECRET_KEY_PATTERN = /(token|secret|password|api[_-]?key|auth(?:orization)?|bearer|credential|cookie|session)/i
const AUTH_SCHEME_PATTERN = /^(?:bearer|basic)$/i

type RedactableMcpServer = McpServer & Record<string, unknown>

/**
 * Returns true if the given key name looks like a credential. Used by the CLI
 * envelope to redact env/header values before printing to stdout.
 */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSensitiveArgKey(key: string): boolean {
  const normalized = key.replace(/^-+/, '').split(/[=:]/, 1)[0].trim()
  return isSecretKey(normalized)
}

function isStandaloneSensitiveArgKey(key: string): boolean {
  return !/[=:]/.test(key) && isSensitiveArgKey(key)
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.username) url.username = REDACTED_VALUE
    if (url.password) url.password = REDACTED_VALUE
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSecretKey(key)) url.searchParams.set(key, REDACTED_VALUE)
    }
    return url.toString()
  } catch {
    return value
  }
}

function redactInlineArg(arg: string): string {
  const redactedUrl = redactUrl(arg)
  if (redactedUrl !== arg) return redactInlineAuth(redactedUrl)

  const kv = arg.match(/^((?:-+)?[^=:\s/]+\s*(?:=|:)\s*)(.*)$/)
  if (kv) {
    const [, prefix, value] = kv
    const key = prefix.replace(/\s*(?:=|:)\s*$/, '')
    if (isSensitiveArgKey(key)) return `${prefix}${REDACTED_VALUE}`
    return `${prefix}${redactInlineAuth(redactUrl(value))}`
  }

  return redactInlineAuth(redactUrl(arg))
}

function redactInlineAuth(value: string): string {
  return value.replace(/\b(Bearer|Basic)\s+([^\s,;]+)/gi, `$1 ${REDACTED_VALUE}`)
}

function redactArgs(args: string[] | undefined): string[] | undefined {
  if (!args) return args
  const out: string[] = []
  let redactNextValue = false

  for (const arg of args) {
    if (redactNextValue) {
      if (AUTH_SCHEME_PATTERN.test(arg)) {
        out.push(arg)
      } else {
        out.push(REDACTED_VALUE)
        redactNextValue = false
      }
      continue
    }

    if (isStandaloneSensitiveArgKey(arg) || AUTH_SCHEME_PATTERN.test(arg)) {
      out.push(arg)
      redactNextValue = true
      continue
    }

    out.push(redactInlineArg(arg))
  }

  return out
}

function redactRecordValues(record: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(record)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    out[k] = isSecretKey(k)
      ? REDACTED_VALUE
      : typeof v === 'string'
        ? redactInlineAuth(redactUrl(v))
        : v
  }
  return out
}

function redactUnknownRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (isSecretKey(key)) {
      out[key] = REDACTED_VALUE
    } else if (typeof value === 'string') {
      out[key] = redactInlineAuth(redactUrl(value))
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => (typeof item === 'string' ? redactInlineArg(item) : item))
    } else if (isPlainObject(value)) {
      out[key] = redactUnknownRecord(value)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Return a copy of `env` with values for credential-looking keys masked. The
 * masked sentinel keeps the key visible so consumers can see the shape of the
 * config without leaking the value. Non-secret values pass through untouched.
 */
export function redactEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return redactRecordValues(env) as Record<string, string> | undefined
}

/** Returns a shallow copy of an MCP server with secret-bearing fields redacted. */
export function redactMcpServer(server: McpServer): McpServer {
  const out: RedactableMcpServer = { ...(server as RedactableMcpServer) }

  out.env = redactRecordValues(out.env) as Record<string, string> | undefined
  out.args = redactArgs(server.args)
  out.url = server.url ? redactUrl(server.url) : server.url
  out.headers = redactRecordValues(out.headers) as Record<string, string> | undefined

  for (const [key, value] of Object.entries(out)) {
    if (isSecretKey(key)) {
      out[key] = REDACTED_VALUE
    } else if (key !== 'env' && key !== 'args' && key !== 'url' && key !== 'headers' && isPlainObject(value)) {
      out[key] = redactUnknownRecord(value)
    }
  }

  return out as McpServer
}
