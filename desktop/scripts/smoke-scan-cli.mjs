#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cliPath = join(desktopRoot, 'out', 'cli', 'agents-manager.js')
const fixturesRoot = join(desktopRoot, 'fixtures', 'scan-cli')
const emptyHome = join(fixturesRoot, 'empty-home')
const claudeHome = join(fixturesRoot, 'claude-home')
const redactedValue = '***redacted***'
const malformedCodexSecret = 'do-not-leak-malformed-codex-api-key-value'
const redactedSecretValues = [
  'do-not-leak-fixture-api-key-value',
  'do-not-leak-fixture-token-value',
]

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: desktopRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  })

  if (result.error) throw result.error
  const expectedStatus = options.expectedStatus ?? 0
  assertEqual(result.status, expectedStatus, `CLI exit status for ${args.join(' ') || '--help'}`)
  assertEqual(result.stderr, '', `CLI stderr for ${args.join(' ') || '--help'}`)
  return { stdout: result.stdout, stderr: result.stderr, status: result.status }
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout)
  } catch (e) {
    fail(`${label} stdout was not valid JSON: ${(e && e.message) || e}\nstdout:\n${stdout}`)
  }
}

function runJson(args, options = {}) {
  const result = runCli(args, options)
  return { ...result, json: parseJson(result.stdout, args.join(' ')) }
}

function summaryByKind(summary, kind) {
  const entry = summary?.find((item) => item.kind === kind)
  assert(entry, `missing summary entry for ${kind}`)
  return entry
}

function assertScanEnvelope(envelope) {
  assertEqual(envelope.ok, true, 'scan envelope.ok')
  assertEqual(envelope.command, 'scan', 'scan envelope.command')
  assert(typeof envelope.version === 'string' && envelope.version.length > 0, 'missing scan envelope.version')
  assert(envelope.data && typeof envelope.data === 'object', 'missing scan envelope.data')
  assert(typeof envelope.data.scanId === 'string' && envelope.data.scanId.length > 0, 'missing data.scanId')
  assert(Number.isFinite(envelope.data.startedAt), 'missing data.startedAt')
  assert(Number.isFinite(envelope.data.finishedAt), 'missing data.finishedAt')
  assert(envelope.data.finishedAt >= envelope.data.startedAt, 'finishedAt precedes startedAt')
  assert(Array.isArray(envelope.data.summary), 'data.summary must be an array')
  assert(Array.isArray(envelope.warnings), 'warnings must be an array')
  assert(Array.isArray(envelope.errors), 'errors must be an array')
  assertEqual(envelope.errors.length, 0, 'errors.length')

  const kinds = envelope.data.summary.map((item) => item.kind).sort()
  assertEqual(JSON.stringify(kinds), JSON.stringify(['claude-code', 'codex', 'openclaw', 'opencode']), 'summary kinds')
}

function assertDoctorEnvelope(envelope) {
  assertEqual(envelope.ok, true, 'doctor envelope.ok')
  assertEqual(envelope.command, 'doctor', 'doctor envelope.command')
  assert(typeof envelope.version === 'string' && envelope.version.length > 0, 'missing doctor envelope.version')
  assert(envelope.data && typeof envelope.data === 'object', 'missing doctor envelope.data')
  assert(envelope.data.runtime && typeof envelope.data.runtime === 'object', 'missing doctor runtime')
  assert(typeof envelope.data.runtime.node === 'string' && envelope.data.runtime.node.length > 0, 'missing runtime.node')
  assert(typeof envelope.data.runtime.platform === 'string' && envelope.data.runtime.platform.length > 0, 'missing runtime.platform')
  assert(typeof envelope.data.runtime.arch === 'string' && envelope.data.runtime.arch.length > 0, 'missing runtime.arch')
  assert(Array.isArray(envelope.data.adapters), 'doctor adapters must be an array')
  assert(Array.isArray(envelope.warnings), 'doctor warnings must be an array')
  assert(Array.isArray(envelope.errors), 'doctor errors must be an array')
  assertEqual(envelope.warnings.length, 0, 'doctor warnings.length')
  assertEqual(envelope.errors.length, 0, 'doctor errors.length')

  const kinds = envelope.data.adapters.map((item) => item.kind).sort()
  assertEqual(JSON.stringify(kinds), JSON.stringify(['claude-code', 'codex', 'openclaw', 'opencode']), 'doctor adapter kinds')
}

function assertAllRootsUnder(homeDir, summary) {
  const expectedRootByKind = {
    'claude-code': join(homeDir, '.claude'),
    codex: join(homeDir, '.codex'),
    opencode: join(homeDir, '.opencode'),
    openclaw: join(homeDir, '.openclaw'),
  }

  for (const item of summary) {
    const expectedRoot = expectedRootByKind[item.kind]
    assertEqual(item.root, expectedRoot, `${item.kind} root should use --home fixture`)
  }
}

function assertZeroCounts(summary, label) {
  for (const [key, value] of Object.entries(summary.counts)) {
    assertEqual(value, 0, `${label} ${key} count`)
  }
}

function assertClaudeFixtureSummary(summary) {
  const claude = summaryByKind(summary, 'claude-code')
  assertEqual(claude.present, true, 'claude fixture should detect Claude Code')
  assertEqual(claude.counts.agents, 1, 'claude agents count')
  assertEqual(claude.counts.skills, 1, 'claude skills count')
  assertEqual(claude.counts.commands, 1, 'claude commands count')
  assertEqual(claude.counts.hooks, 1, 'claude hooks count')
  assertEqual(claude.counts.mcpServers, 1, 'claude mcpServers count')
  assertEqual(claude.counts.plugins, 0, 'claude plugins count')
  assertEqual(claude.errors.length, 0, 'claude fixture errors')

  for (const kind of ['codex', 'opencode', 'openclaw']) {
    const item = summaryByKind(summary, kind)
    assertEqual(item.present, false, `${kind} should not be present in claude fixture`)
    assertZeroCounts(item, `${kind} claude fixture`)
    assertEqual(item.errors.length, 0, `${kind} claude fixture errors`)
  }
}

function makeDecoyHome() {
  const decoy = mkdtempSync(join(tmpdir(), 'agents-manager-scan-cli-decoy-'))
  mkdirSync(join(decoy, '.claude'), { recursive: true })
  writeFileSync(
    join(decoy, '.claude', 'settings.json'),
    JSON.stringify({ version: 'decoy-home-must-not-be-read' }, null, 2),
  )
  return decoy
}

function makeMalformedCodexHome() {
  const home = mkdtempSync(join(tmpdir(), 'agents-manager-scan-cli-malformed-codex-'))
  mkdirSync(join(home, '.codex'), { recursive: true })
  writeFileSync(
    join(home, '.codex', 'config.toml'),
    [
      '[mcp_servers.leaky]',
      'command = "fixture-command"',
      '',
      '[mcp_servers.leaky.env]',
      `API_KEY = "${malformedCodexSecret}" trailing-token`,
      'VISIBLE_FIXTURE_FLAG = "ok"',
      '',
    ].join('\n'),
  )
  return home
}

const decoyHome = makeDecoyHome()
const malformedCodexHome = makeMalformedCodexHome()
try {
  const firstLine = readFileSync(cliPath, 'utf8').split('\n')[0]
  assertEqual(firstLine, '#!/usr/bin/env node', 'CLI shebang')

  const topHelp = runCli(['--help'])
  assert(topHelp.stdout.includes('Commands:'), 'top-level help should list commands')
  assert(topHelp.stdout.includes('scan'), 'top-level help should mention scan')
  assert(topHelp.stdout.includes('doctor'), 'top-level help should mention doctor')

  const scanHelp = runCli(['scan', '--help'])
  assert(scanHelp.stdout.includes('Usage:'), 'scan help should include usage')
  assert(scanHelp.stdout.includes('--include-mcp'), 'scan help should mention --include-mcp')

  const doctorHelp = runCli(['doctor', '--help'])
  assert(doctorHelp.stdout.includes('Usage:'), 'doctor help should include usage')
  assert(doctorHelp.stdout.includes('--home'), 'doctor help should mention --home')

  const unknownResult = runJson(['definitely-not-a-command'], { expectedStatus: 1 })
  assertEqual(unknownResult.json.ok, false, 'unknown command ok')
  assertEqual(unknownResult.json.command, 'definitely-not-a-command', 'unknown command envelope.command')
  assertEqual(unknownResult.json.data, null, 'unknown command data')
  assert(Array.isArray(unknownResult.json.errors), 'unknown command errors must be an array')
  assert(unknownResult.json.errors[0].includes('unknown command'), 'unknown command error message')

  const emptyResult = runJson(['scan', '--home', emptyHome], { env: { HOME: decoyHome } })
  assertScanEnvelope(emptyResult.json)
  assertEqual(emptyResult.json.data.homeDir, resolve(emptyHome), 'empty fixture homeDir')
  assertAllRootsUnder(emptyHome, emptyResult.json.data.summary)
  for (const item of emptyResult.json.data.summary) {
    assertEqual(item.present, false, `${item.kind} should not be present in empty fixture`)
    assertZeroCounts(item, `${item.kind} empty fixture`)
    assertEqual(item.errors.length, 0, `${item.kind} empty fixture errors`)
  }

  const claudeResult = runJson(['scan', '--home', claudeHome])
  assertScanEnvelope(claudeResult.json)
  assertEqual(claudeResult.json.data.homeDir, resolve(claudeHome), 'claude fixture homeDir')
  assertAllRootsUnder(claudeHome, claudeResult.json.data.summary)
  assertClaudeFixtureSummary(claudeResult.json.data.summary)

  const doctorResult = runJson(['doctor', '--home', claudeHome], { env: { HOME: decoyHome } })
  assertDoctorEnvelope(doctorResult.json)
  assertAllRootsUnder(claudeHome, doctorResult.json.data.adapters)
  assertClaudeFixtureSummary(doctorResult.json.data.adapters)
  assert(!('summary' in doctorResult.json.data), 'doctor must not emit scan summary key')
  assert(!('mcpServers' in doctorResult.json.data), 'doctor must not emit MCP definitions')
  assert(!doctorResult.stdout.includes('fixture-mcp'), 'doctor must not emit MCP server names')
  assert(!doctorResult.stdout.includes('"env"'), 'doctor must not emit env blocks')
  for (const secret of redactedSecretValues) {
    assert(!doctorResult.stdout.includes(secret), `doctor leaked secret value: ${secret}`)
  }

  const malformedDoctorResult = runJson(['doctor', '--home', malformedCodexHome], { env: { HOME: decoyHome } })
  assertDoctorEnvelope(malformedDoctorResult.json)
  assertAllRootsUnder(malformedCodexHome, malformedDoctorResult.json.data.adapters)
  const malformedCodex = summaryByKind(malformedDoctorResult.json.data.adapters, 'codex')
  assertEqual(malformedCodex.present, true, 'malformed codex fixture should be present')
  assert(malformedCodex.errors.length > 0, 'malformed codex fixture should surface sanitized parse errors')
  const malformedCodexErrors = malformedCodex.errors.join('\n')
  assert(malformedCodexErrors.includes('config.toml parse failed'), 'missing malformed config parse error')
  assert(malformedCodexErrors.includes(redactedValue), 'malformed config secret should be redacted')
  assert(
    !malformedDoctorResult.stdout.includes(malformedCodexSecret),
    'doctor leaked malformed config secret value',
  )

  const mcpResult = runJson(['scan', '--home', claudeHome, '--include-mcp'])
  assertScanEnvelope(mcpResult.json)
  for (const secret of redactedSecretValues) {
    assert(!mcpResult.stdout.includes(secret), `secret value leaked in scan stdout: ${secret}`)
  }

  const mcpServers = mcpResult.json.data.mcpServers
  assert(Array.isArray(mcpServers), 'include-mcp should emit data.mcpServers')
  assertEqual(mcpServers.length, 1, 'mcp server count')
  const [server] = mcpServers
  assertEqual(server.name, 'fixture-mcp', 'mcp server name')
  assertEqual(server.env.FIXTURE_API_KEY, redactedValue, 'FIXTURE_API_KEY redaction')
  assertEqual(server.env.FIXTURE_TOKEN, redactedValue, 'FIXTURE_TOKEN redaction')
  assertEqual(server.env.VISIBLE_FIXTURE_FLAG, 'visible-fixture-value', 'non-secret env passthrough')
  assert(
    mcpResult.json.warnings.includes('mcp env values were redacted; pass through scan only, not deploy'),
    'missing MCP redaction warning',
  )

  console.log('agents-manager CLI smoke: ok')
} finally {
  rmSync(decoyHome, { recursive: true, force: true })
  rmSync(malformedCodexHome, { recursive: true, force: true })
}
