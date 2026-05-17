#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cliPath = join(desktopRoot, 'out', 'cli', 'scan.js')
const fixturesRoot = join(desktopRoot, 'fixtures', 'scan-cli')
const emptyHome = join(fixturesRoot, 'empty-home')
const claudeHome = join(fixturesRoot, 'claude-home')
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

function runScan(args, options = {}) {
  const stdout = execFileSync(process.execPath, [cliPath, ...args], {
    cwd: desktopRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  })
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (e) {
    fail(`CLI stdout was not valid JSON: ${(e && e.message) || e}\nstdout:\n${stdout}`)
  }
  return { stdout, json: parsed }
}

function summaryByKind(envelope, kind) {
  const entry = envelope.data?.summary?.find((item) => item.kind === kind)
  assert(entry, `missing summary entry for ${kind}`)
  return entry
}

function assertEnvelope(envelope) {
  assertEqual(envelope.ok, true, 'envelope.ok')
  assertEqual(envelope.command, 'scan', 'envelope.command')
  assert(typeof envelope.version === 'string' && envelope.version.length > 0, 'missing envelope.version')
  assert(envelope.data && typeof envelope.data === 'object', 'missing envelope.data')
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

function assertAllRootsUnder(homeDir, envelope) {
  const expectedRootByKind = {
    'claude-code': join(homeDir, '.claude'),
    codex: join(homeDir, '.codex'),
    opencode: join(homeDir, '.opencode'),
    openclaw: join(homeDir, '.openclaw'),
  }

  for (const item of envelope.data.summary) {
    const expectedRoot = expectedRootByKind[item.kind]
    assertEqual(item.root, expectedRoot, `${item.kind} root should use --home fixture`)
  }
}

function assertZeroCounts(summary, label) {
  for (const [key, value] of Object.entries(summary.counts)) {
    assertEqual(value, 0, `${label} ${key} count`)
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

const decoyHome = makeDecoyHome()
try {
  const emptyResult = runScan(['--home', emptyHome], { env: { HOME: decoyHome } })
  assertEnvelope(emptyResult.json)
  assertEqual(emptyResult.json.data.homeDir, resolve(emptyHome), 'empty fixture homeDir')
  assertAllRootsUnder(emptyHome, emptyResult.json)
  for (const item of emptyResult.json.data.summary) {
    assertEqual(item.present, false, `${item.kind} should not be present in empty fixture`)
    assertZeroCounts(item, `${item.kind} empty fixture`)
    assertEqual(item.errors.length, 0, `${item.kind} empty fixture errors`)
  }

  const claudeResult = runScan(['--home', claudeHome])
  assertEnvelope(claudeResult.json)
  assertEqual(claudeResult.json.data.homeDir, resolve(claudeHome), 'claude fixture homeDir')
  assertAllRootsUnder(claudeHome, claudeResult.json)

  const claude = summaryByKind(claudeResult.json, 'claude-code')
  assertEqual(claude.present, true, 'claude fixture should detect Claude Code')
  assertEqual(claude.counts.agents, 1, 'claude agents count')
  assertEqual(claude.counts.skills, 1, 'claude skills count')
  assertEqual(claude.counts.commands, 1, 'claude commands count')
  assertEqual(claude.counts.hooks, 1, 'claude hooks count')
  assertEqual(claude.counts.mcpServers, 1, 'claude mcpServers count')
  assertEqual(claude.counts.plugins, 0, 'claude plugins count')
  assertEqual(claude.errors.length, 0, 'claude fixture errors')

  for (const kind of ['codex', 'opencode', 'openclaw']) {
    const item = summaryByKind(claudeResult.json, kind)
    assertEqual(item.present, false, `${kind} should not be present in claude fixture`)
    assertZeroCounts(item, `${kind} claude fixture`)
    assertEqual(item.errors.length, 0, `${kind} claude fixture errors`)
  }

  const mcpResult = runScan(['--home', claudeHome, '--include-mcp'])
  assertEnvelope(mcpResult.json)
  for (const secret of redactedSecretValues) {
    assert(!mcpResult.stdout.includes(secret), `secret value leaked in stdout: ${secret}`)
  }

  const mcpServers = mcpResult.json.data.mcpServers
  assert(Array.isArray(mcpServers), 'include-mcp should emit data.mcpServers')
  assertEqual(mcpServers.length, 1, 'mcp server count')
  const [server] = mcpServers
  assertEqual(server.name, 'fixture-mcp', 'mcp server name')
  assertEqual(server.env.FIXTURE_API_KEY, '***redacted***', 'FIXTURE_API_KEY redaction')
  assertEqual(server.env.FIXTURE_TOKEN, '***redacted***', 'FIXTURE_TOKEN redaction')
  assertEqual(server.env.VISIBLE_FIXTURE_FLAG, 'visible-fixture-value', 'non-secret env passthrough')
  assert(
    mcpResult.json.warnings.includes('mcp env values were redacted; pass through scan only, not deploy'),
    'missing MCP redaction warning',
  )

  console.log('scan CLI smoke: ok')
} finally {
  rmSync(decoyHome, { recursive: true, force: true })
}
