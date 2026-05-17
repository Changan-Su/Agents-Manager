/**
 * Multi-command CLI entry for Agents Manager. It intentionally stays read-only:
 * commands invoke the pure scan core, print JSON envelopes where appropriate,
 * and never touch persistence, IPC handlers, or live agent config files.
 */
import { resolve } from 'node:path'
import { isSecretKey, runScan, redactMcpServer } from '../core/scan'
import type { AgentSummary, McpServer } from '../../../shared/types'

const CLI_VERSION = '0.1.0'
const BIN = 'agents-manager'

type CommandName = 'scan' | 'doctor'

interface BaseArgs {
  homeDir?: string
  help: boolean
}

interface ScanArgs extends BaseArgs {
  includeMcp: boolean
}

type DoctorArgs = BaseArgs

interface ScanEnvelopeData {
  scanId: string
  startedAt: number
  finishedAt: number
  homeDir: string | null
  summary: AgentSummary[]
  mcpServers?: McpServer[]
}

interface DoctorEnvelopeData {
  runtime: {
    node: string
    platform: string
    arch: string
  }
  adapters: AgentSummary[]
}

interface Envelope<T> {
  ok: boolean
  command: string
  version: string
  data: T | null
  warnings: string[]
  errors: string[]
}

interface AdapterSummaryOptions {
  sanitizeErrors?: boolean
}

const REDACTED_VALUE = '***redacted***'

function parseHomeArg(argv: string[], index: number): { value: string; nextIndex: number } {
  const current = argv[index]
  if (current.startsWith('--home=')) {
    const value = current.slice('--home='.length)
    if (!value) throw new Error('--home requires a path argument')
    return { value: resolve(value), nextIndex: index }
  }

  const value = argv[index + 1]
  if (!value) throw new Error('--home requires a path argument')
  return { value: resolve(value), nextIndex: index + 1 }
}

function parseScanArgs(argv: string[]): ScanArgs {
  const out: ScanArgs = { includeMcp: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '-h':
      case '--help':
        out.help = true
        break
      case '--home': {
        const parsed = parseHomeArg(argv, i)
        out.homeDir = parsed.value
        i = parsed.nextIndex
        break
      }
      case '--include-mcp':
        out.includeMcp = true
        break
      default:
        if (a.startsWith('--home=')) {
          const parsed = parseHomeArg(argv, i)
          out.homeDir = parsed.value
        } else {
          throw new Error(`unknown argument: ${a}`)
        }
    }
  }
  return out
}

function parseDoctorArgs(argv: string[]): DoctorArgs {
  const out: DoctorArgs = { help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '-h':
      case '--help':
        out.help = true
        break
      case '--home': {
        const parsed = parseHomeArg(argv, i)
        out.homeDir = parsed.value
        i = parsed.nextIndex
        break
      }
      default:
        if (a.startsWith('--home=')) {
          const parsed = parseHomeArg(argv, i)
          out.homeDir = parsed.value
        } else {
          throw new Error(`unknown argument: ${a}`)
        }
    }
  }
  return out
}

function printTopLevelHelp(): void {
  const lines = [
    'Agents Manager CLI — read-only inventory helpers for local AI coding agents',
    '',
    'Usage:',
    `  ${BIN} <command> [options]`,
    `  ${BIN} --help`,
    '',
    'Commands:',
    '  scan     Print a scan JSON envelope; can optionally include redacted MCP definitions.',
    '  doctor   Print runtime plus adapter summary/counts/errors only.',
    '',
    'Run per-command help with:',
    `  ${BIN} scan --help`,
    `  ${BIN} doctor --help`,
  ]
  process.stdout.write(lines.join('\n') + '\n')
}

function printScanHelp(): void {
  const lines = [
    `${BIN} scan — read-only inventory of local AI coding agents`,
    '',
    'Usage:',
    `  ${BIN} scan [--home <path>] [--include-mcp]`,
    '',
    'Options:',
    '  --home <path>     Override the home directory (use a fixture/sandbox path).',
    '  --include-mcp     Include MCP server definitions in the envelope (secrets are redacted).',
    '  -h, --help        Show this help.',
    '',
    'Output: a single JSON envelope on stdout. Exit code 0 on success, 1 on failure.',
  ]
  process.stdout.write(lines.join('\n') + '\n')
}

function printDoctorHelp(): void {
  const lines = [
    `${BIN} doctor — read-only CLI/runtime and adapter diagnostics`,
    '',
    'Usage:',
    `  ${BIN} doctor [--home <path>]`,
    '',
    'Options:',
    '  --home <path>     Override the home directory (use a fixture/sandbox path).',
    '  -h, --help        Show this help.',
    '',
    'Output: a single JSON envelope with runtime plus adapter summary/counts/errors only.',
  ]
  process.stdout.write(lines.join('\n') + '\n')
}

function emit<T>(envelope: Envelope<T>): void {
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n')
}

function emitError(command: string, message: string): void {
  emit({
    ok: false,
    command,
    version: CLI_VERSION,
    data: null,
    warnings: [],
    errors: [message],
  })
}

function sanitizeDiagnosticMessage(message: string): string {
  return message
    .split(/(\r?\n)/)
    .map((part) => {
      if (part === '\n' || part === '\r\n') return part
      return sanitizeDiagnosticLine(part)
    })
    .join('')
}

function sanitizeDiagnosticLine(line: string): string {
  return line
    .replace(
      /((?:["'])?([A-Za-z_][\w.-]*)(?:["'])?\s*(?:=|:)\s*)(["'])([^"'\r\n]*)(\3)/g,
      (match, prefix: string, key: string, quote: string, _value: string, suffix: string) =>
        isSecretKey(key) ? `${prefix}${quote}${REDACTED_VALUE}${suffix}` : match,
    )
    .replace(
      /((?:["'])?([A-Za-z_][\w.-]*)(?:["'])?\s*(?:=|:)\s*)([^\s,}\]#\r\n]+)/g,
      (match, prefix: string, key: string) =>
        isSecretKey(key) ? `${prefix}${REDACTED_VALUE}` : match,
    )
}

function adapterSummaries(
  summary: AgentSummary[],
  options: AdapterSummaryOptions = {},
): AgentSummary[] {
  return summary.map((item) => ({
    kind: item.kind,
    present: item.present,
    root: item.root,
    counts: {
      agents: item.counts.agents,
      skills: item.counts.skills,
      plugins: item.counts.plugins,
      commands: item.counts.commands,
      hooks: item.counts.hooks,
      mcpServers: item.counts.mcpServers,
    },
    errors: options.sanitizeErrors
      ? item.errors.map(sanitizeDiagnosticMessage)
      : [...item.errors],
  }))
}

async function runScanCommand(argv: string[]): Promise<number> {
  let args: ScanArgs
  try {
    args = parseScanArgs(argv)
  } catch (e) {
    emitError('scan', (e as Error).message)
    return 1
  }

  if (args.help) {
    printScanHelp()
    return 0
  }

  const warnings: string[] = []
  try {
    const result = await runScan({ homeDir: args.homeDir })
    const data: ScanEnvelopeData = {
      scanId: result.scanId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      homeDir: args.homeDir ?? null,
      summary: adapterSummaries(result.summary, { sanitizeErrors: true }),
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
      command: 'scan',
      version: CLI_VERSION,
      data,
      warnings,
      errors: [],
    })
    return 0
  } catch (e) {
    emitError('scan', (e as Error).message)
    return 1
  }
}

async function runDoctorCommand(argv: string[]): Promise<number> {
  let args: DoctorArgs
  try {
    args = parseDoctorArgs(argv)
  } catch (e) {
    emitError('doctor', (e as Error).message)
    return 1
  }

  if (args.help) {
    printDoctorHelp()
    return 0
  }

  try {
    const result = await runScan({ homeDir: args.homeDir })
    emit<DoctorEnvelopeData>({
      ok: true,
      command: 'doctor',
      version: CLI_VERSION,
      data: {
        runtime: {
          node: process.versions.node,
          platform: process.platform,
          arch: process.arch,
        },
        adapters: adapterSummaries(result.summary, { sanitizeErrors: true }),
      },
      warnings: [],
      errors: [],
    })
    return 0
  } catch (e) {
    emitError('doctor', sanitizeDiagnosticMessage((e as Error).message))
    return 1
  }
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv

  if (!command || command === '-h' || command === '--help') {
    printTopLevelHelp()
    return 0
  }

  if (command === 'help') {
    const topic = rest[0]
    if (topic === 'scan') printScanHelp()
    else if (topic === 'doctor') printDoctorHelp()
    else printTopLevelHelp()
    return 0
  }

  switch (command as CommandName) {
    case 'scan':
      return runScanCommand(rest)
    case 'doctor':
      return runDoctorCommand(rest)
    default:
      emitError(command, `unknown command: ${command}`)
      return 1
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (e) => {
    emitError('agents-manager', (e as Error).message ?? String(e))
    process.exitCode = 1
  },
)
