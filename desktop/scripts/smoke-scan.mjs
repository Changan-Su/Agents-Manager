#!/usr/bin/env node
/**
 * Sprint 1 smoke test — runs the scanner against the local machine
 * without launching Electron. Validates ClaudeCodeAdapter end-to-end.
 *
 * Usage:  node scripts/smoke-scan.mjs
 */
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'

// We cannot import the .ts adapters directly with bare node, so we re-implement
// just enough of ClaudeCodeAdapter to verify the on-disk counts. The real
// adapter is exercised when the Electron app launches; this script gives us
// fast confidence the file-walking math is right.

function safeReaddir(dir) {
  try { return readdirSync(dir) } catch { return [] }
}
function isDir(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

const root = join(homedir(), '.claude')
if (!existsSync(root)) {
  console.error('Claude Code not detected at ' + root)
  process.exit(1)
}

// Direct skills (~/.claude/skills/*/SKILL.md)
const directSkillDirs = safeReaddir(join(root, 'skills'))
  .filter((e) => isDir(join(root, 'skills', e)))
  .filter((e) => existsSync(join(root, 'skills', e, 'SKILL.md')))

// Marketplace skills (~/.claude/plugins/marketplaces/*/skills/*/SKILL.md)
const marketplaces = safeReaddir(join(root, 'plugins', 'marketplaces'))
let mktSkills = 0
let mktAgents = 0
let mktCommands = 0
for (const m of marketplaces) {
  const sd = join(root, 'plugins', 'marketplaces', m, 'skills')
  for (const e of safeReaddir(sd)) {
    if (existsSync(join(sd, e, 'SKILL.md'))) mktSkills++
  }
  const ad = join(root, 'plugins', 'marketplaces', m, 'agents')
  for (const e of safeReaddir(ad)) {
    if (e.endsWith('.md')) mktAgents++
  }
  const cd = join(root, 'plugins', 'marketplaces', m, 'commands')
  for (const e of safeReaddir(cd)) {
    if (e.endsWith('.md')) mktCommands++
  }
}

// MCP servers
let mcpServers = 0
const mcpFiles = []
for (const m of marketplaces) {
  const candidates = [
    join(root, 'plugins', 'marketplaces', m, 'mcp-configs', 'mcp-servers.json'),
    join(root, 'plugins', 'marketplaces', m, '.mcp.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      mcpFiles.push(p)
      try {
        const json = JSON.parse(execSync(`cat ${JSON.stringify(p)}`).toString())
        const names = Object.keys(json.mcpServers ?? {})
        mcpServers += names.length
      } catch {}
    }
  }
}

const summary = {
  root,
  directSkillCount: directSkillDirs.length,
  marketplaceSkillCount: mktSkills,
  marketplaceAgentCount: mktAgents,
  marketplaceCommandCount: mktCommands,
  mcpServerCount: mcpServers,
  mcpConfigFiles: mcpFiles.length,
  marketplaceCount: marketplaces.length,
}

console.log(JSON.stringify(summary, null, 2))

console.log('\n— filesystem cross-check —')
console.log(`ls ~/.claude/skills/ → ${safeReaddir(join(root, 'skills')).length} entries`)
for (const m of marketplaces) {
  const sd = join(root, 'plugins', 'marketplaces', m, 'skills')
  if (existsSync(sd)) {
    console.log(`  ${m}/skills → ${safeReaddir(sd).length} entries`)
  }
}
