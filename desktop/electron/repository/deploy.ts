import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { adapters } from '../scanner/registry'
import { recordDeployment, clearDeployment, getRepository } from './store'
import type {
  AgentKind,
  DeployResult,
  DeployTarget,
  RepositoryItem,
} from '../../../shared/types'

interface ResolvedTarget {
  agentKind: AgentKind
  scope: 'user' | 'project'
  rootDir: string
}

async function resolveAgentRoot(target: DeployTarget): Promise<ResolvedTarget> {
  if (target.scope === 'project') {
    if (!target.projectPath) {
      throw new Error('projectPath required for project-scope deployment')
    }
    const proj = resolve(target.projectPath)
    if (!existsSync(proj)) throw new Error(`project path does not exist: ${proj}`)
    // Per Claude Code convention, project-level lives at <project>/.claude/.
    if (target.agentKind === 'claude-code') {
      return { agentKind: 'claude-code', scope: 'project', rootDir: join(proj, '.claude') }
    }
    if (target.agentKind === 'codex') {
      return { agentKind: 'codex', scope: 'project', rootDir: join(proj, '.codex') }
    }
    if (target.agentKind === 'opencode') {
      return { agentKind: 'opencode', scope: 'project', rootDir: join(proj, '.opencode') }
    }
    throw new Error(`project-scope deploy not supported for ${target.agentKind}`)
  }

  const adapter = adapters.find((a) => a.kind === target.agentKind)
  if (!adapter) throw new Error(`unknown agent kind: ${target.agentKind}`)
  const det = await adapter.detect()
  return { agentKind: target.agentKind, scope: 'user', rootDir: det.root }
}

export async function deployItem(
  itemId: string,
  targets: DeployTarget[],
): Promise<DeployResult> {
  const item = getRepository(itemId)
  if (!item) throw new Error(`repository item not found: ${itemId}`)

  const applied: DeployResult['applied'] = []
  const errors: string[] = []

  for (const target of targets) {
    try {
      const resolved = await resolveAgentRoot(target)
      mkdirSync(resolved.rootDir, { recursive: true })
      const result = deployOne(item, resolved)
      applied.push({
        deploymentId: result.deploymentId,
        agentKind: resolved.agentKind,
        scope: resolved.scope,
        targetPath: result.targetPath,
        backupPath: result.backupPath,
      })
    } catch (e) {
      errors.push(`${target.agentKind}/${target.scope}: ${(e as Error).message}`)
    }
  }

  if (applied.length) {
    const additions: RepositoryItem['deployedTo'] = applied.map((a) => ({
      deploymentId: a.deploymentId,
      agentKind: a.agentKind,
      scope: a.scope,
      targetRoot: targetRootFor(a.agentKind, a.scope, targets),
      targetPath: a.targetPath,
      deployedAt: Date.now(),
    }))
    recordDeployment(item.id, additions)
  }

  return { applied, errors }
}

export async function undeployItem(itemId: string, deploymentId: string): Promise<{
  ok: boolean
  removed?: string
  error?: string
}> {
  const item = getRepository(itemId)
  if (!item) return { ok: false, error: 'item not found' }
  const dep = item.deployedTo.find((d) => d.deploymentId === deploymentId)
  if (!dep) return { ok: false, error: 'deployment not found' }

  // We deliberately don't delete files for skills/commands/hooks: a user might
  // have hand-edited them since deployment. Record removal in metadata only.
  // For mcp_server entries we DO remove the registered key from settings.json,
  // since otherwise the live agent will keep launching it.
  if (item.kind === 'mcp_server' && item.manifest.mcpServerEntry) {
    const settingsPath = mcpSettingsPathFor(dep.agentKind, dep.targetRoot)
    if (settingsPath && existsSync(settingsPath)) {
      try {
        const cur = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
        const servers = cur.mcpServers as Record<string, unknown> | undefined
        if (servers && item.manifest.mcpServerEntry.name in servers) {
          delete servers[item.manifest.mcpServerEntry.name]
          backupAndWrite(settingsPath, JSON.stringify(cur, null, 2) + '\n')
        }
      } catch {
        // ignore — settings parse error: don't delete blindly
      }
    }
  }

  clearDeployment(item.id, deploymentId)
  return { ok: true, removed: dep.targetPath }
}

// ── one-target deploy logic ────────────────────────────────────────────────

interface OneResult {
  deploymentId: string
  targetPath: string
  backupPath?: string
}

function deployOne(item: RepositoryItem, resolved: ResolvedTarget): OneResult {
  const deploymentId = randomUUID()
  switch (item.kind) {
    case 'skill':
      return deploySkill(item, resolved, deploymentId)
    case 'command':
      return deployFile(item, resolved, deploymentId, 'commands')
    case 'hook':
      return deployFile(item, resolved, deploymentId, 'hooks')
    case 'agent_def':
      return deployFile(item, resolved, deploymentId, 'agents')
    case 'mcp_server':
      return deployMcp(item, resolved, deploymentId)
    default:
      throw new Error(`unsupported repository kind: ${item.kind}`)
  }
}

function deploySkill(
  item: RepositoryItem,
  resolved: ResolvedTarget,
  deploymentId: string,
): OneResult {
  const targetDir = join(resolved.rootDir, 'skills', item.name)
  let backupPath: string | undefined
  if (existsSync(targetDir)) {
    const ts = isoTs()
    backupPath = `${targetDir}.bak.${ts}.pre-deploy`
    cpSync(targetDir, backupPath, { recursive: true })
  } else {
    mkdirSync(dirname(targetDir), { recursive: true })
  }
  cpSync(item.storagePath, targetDir, { recursive: true })
  return { deploymentId, targetPath: targetDir, backupPath }
}

function deployFile(
  item: RepositoryItem,
  resolved: ResolvedTarget,
  deploymentId: string,
  subdir: string,
): OneResult {
  const primary = item.manifest.primaryFile
  if (!primary) throw new Error(`item has no primaryFile (kind=${item.kind})`)
  const src = join(item.storagePath, primary)
  if (!existsSync(src)) throw new Error(`primaryFile missing on disk: ${primary}`)
  const dir = join(resolved.rootDir, subdir)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, primary)
  let backupPath: string | undefined
  if (existsSync(target)) {
    const ts = isoTs()
    backupPath = `${target}.bak.${ts}.pre-deploy`
    copyFileSync(target, backupPath)
  }
  copyFileSync(src, target)
  return { deploymentId, targetPath: target, backupPath }
}

function deployMcp(
  item: RepositoryItem,
  resolved: ResolvedTarget,
  deploymentId: string,
): OneResult {
  const entry = item.manifest.mcpServerEntry
  if (!entry) throw new Error('mcp_server item missing mcpServerEntry in manifest')
  const settingsPath = mcpSettingsPathFor(resolved.agentKind, resolved.rootDir)
  if (!settingsPath) {
    throw new Error(`don't know how to register mcp for ${resolved.agentKind}`)
  }
  let cur: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      cur = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    } catch (e) {
      throw new Error(`cannot parse ${settingsPath}: ${(e as Error).message}`)
    }
  }
  const servers = (cur.mcpServers as Record<string, unknown>) ?? {}
  servers[entry.name] = stripUndefined({
    command: entry.command,
    args: entry.args,
    env: entry.env,
    type: entry.type,
    url: entry.url,
  })
  cur.mcpServers = servers
  const backupPath = backupAndWrite(settingsPath, JSON.stringify(cur, null, 2) + '\n')
  return { deploymentId, targetPath: settingsPath, backupPath }
}

function mcpSettingsPathFor(agentKind: AgentKind, root: string): string | null {
  switch (agentKind) {
    case 'claude-code':
      return join(root, 'settings.json')
    case 'opencode':
      return join(root, 'opencode.json')
    case 'codex':
      // Codex stores mcp_servers in config.toml, but we can't safely round-trip
      // arbitrary TOML edits. Surface that via error in v1.
      return null
    default:
      return null
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function targetRootFor(
  agentKind: AgentKind,
  scope: 'user' | 'project',
  targets: DeployTarget[],
): string {
  const t = targets.find((x) => x.agentKind === agentKind && x.scope === scope)
  return t?.projectPath ?? ''
}

function isoTs(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function backupAndWrite(path: string, content: string): string | undefined {
  let backupPath: string | undefined
  if (existsSync(path)) {
    const ts = isoTs()
    backupPath = `${path}.bak.${ts}.pre-deploy`
    copyFileSync(path, backupPath)
  } else {
    mkdirSync(dirname(path), { recursive: true })
  }
  // Atomic write: write to .tmp + rename, so a crash mid-write doesn't
  // leave a half-baked settings.json.
  const tmp = `${path}.tmp-${randomUUID()}`
  writeFileSync(tmp, content, 'utf-8')
  const fs = require('node:fs') as typeof import('node:fs')
  fs.renameSync(tmp, path)
  return backupPath
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

// keep `sep` import alive for tooling
void sep
