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

const SECRET_KEY_PATTERN = /(token|secret|password|api[_-]?key|auth|bearer|credential)/i

/**
 * Returns true if the given key name looks like a credential. Used by the CLI
 * envelope to redact env/header values before printing to stdout.
 */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

/**
 * Return a copy of `env` with values for credential-looking keys masked. The
 * masked sentinel keeps the key visible so consumers can see the shape of the
 * config without leaking the value. Non-secret values pass through untouched.
 */
export function redactEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) return env
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    out[k] = isSecretKey(k) ? '***redacted***' : v
  }
  return out
}

/** Returns a shallow copy of an MCP server with env values redacted. */
export function redactMcpServer(server: McpServer): McpServer {
  return { ...server, env: redactEnv(server.env) }
}
