/**
 * scan-only CLI entry. Intentionally minimal: parses argv, invokes the scan
 * core with an optional `--home <path>` override (so callers can point at a
 * sandbox fixture instead of a real user home), and writes a JSON envelope to
 * stdout. Does not touch the database, does not write IPC handlers, does not
 * mutate any agent config.
 */
import { resolve } from 'node:path'
import { runScan, redactMcpServer } from '../core/scan'
import type { AgentSummary, McpServer } from '../../../shared/types'

const CLI_VERSION = '0.1.0'
const COMMAND = 'scan'

interface CliArgs {
  homeDir?: string
  includeMcp: boolean
  help: boolean
}

interface EnvelopeData {
  scanId: string
  startedAt: number
  finishedAt: number
  homeDir: string | null
  summary: AgentSummary[]
  mcpServers?: McpServer[]
}

interface Envelope {
  ok: boolean
  command: string
  version: string
  data: EnvelopeData | null
  warnings: string[]
  errors: string[]
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { includeMcp: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '-h':
      case '--help':
        out.help = true
        break
      case '--home': {
        const v = argv[++i]
        if (!v) throw new Error('--home requires a path argument')
        out.homeDir = resolve(v)
        break
      }
      case '--include-mcp':
        out.includeMcp = true
        break
      default:
        if (a.startsWith('--home=')) {
          out.homeDir = resolve(a.slice('--home='.length))
        } else {
          throw new Error(`unknown argument: ${a}`)
        }
    }
  }
  return out
}

function printHelp(): void {
  const lines = [
    'agents-manager scan — read-only inventory of local AI coding agents',
    '',
    'Usage:',
    '  scan [--home <path>] [--include-mcp]',
    '',
    'Options:',
    '  --home <path>     Override the home directory (use a fixture/sandbox path).',
    '  --include-mcp     Include MCP server definitions in the envelope (env vars are redacted).',
    '  -h, --help        Show this help.',
    '',
    'Output: a single JSON envelope on stdout. Exit code 0 on success, 1 on failure.',
  ]
  process.stdout.write(lines.join('\n') + '\n')
}

function emit(envelope: Envelope): void {
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n')
}

async function main(): Promise<number> {
  let args: CliArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    emit({
      ok: false,
      command: COMMAND,
      version: CLI_VERSION,
      data: null,
      warnings: [],
      errors: [(e as Error).message],
    })
    return 1
  }

  if (args.help) {
    printHelp()
    return 0
  }

  const warnings: string[] = []
  try {
    const result = await runScan({ homeDir: args.homeDir })
    const data: EnvelopeData = {
      scanId: result.scanId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      homeDir: args.homeDir ?? null,
      summary: result.summary,
    }

    if (args.includeMcp) {
      const servers: McpServer[] = []
      for (const r of result.perAgent) {
        for (const s of r.mcpServers) servers.push(redactMcpServer(s))
      }
      data.mcpServers = servers
      if (servers.some((s) => s.env && Object.keys(s.env).length > 0)) {
        warnings.push('mcp env values were redacted; pass through scan only, not deploy')
      }
    }

    emit({
      ok: true,
      command: COMMAND,
      version: CLI_VERSION,
      data,
      warnings,
      errors: [],
    })
    return 0
  } catch (e) {
    emit({
      ok: false,
      command: COMMAND,
      version: CLI_VERSION,
      data: null,
      warnings,
      errors: [(e as Error).message],
    })
    return 1
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (e) => {
    emit({
      ok: false,
      command: COMMAND,
      version: CLI_VERSION,
      data: null,
      warnings: [],
      errors: [(e as Error).message ?? String(e)],
    })
    process.exitCode = 1
  },
)
