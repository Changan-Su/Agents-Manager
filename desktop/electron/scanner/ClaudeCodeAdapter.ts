import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import matter from 'gray-matter'
import type {
  AgentAdapter,
} from './AgentAdapter'
import type {
  Asset,
  McpServer,
  AgentDetection,
  ScanResult,
} from '../../../shared/types'
import { buildAsset, asStringArray } from './normalize'

const KIND = 'claude-code' as const

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind = KIND

  async detect(): Promise<AgentDetection> {
    const root = join(homedir(), '.claude')
    const present = existsSync(root) && existsSync(join(root, 'settings.json'))
    let version: string | undefined
    if (present) {
      try {
        const settings = JSON.parse(
          readFileSync(join(root, 'settings.json'), 'utf-8'),
        )
        version = settings?.version ?? settings?.harnessVersion
      } catch {
        // ignore
      }
    }
    return { kind: KIND, present, root, version }
  }

  async scan(detection: AgentDetection): Promise<ScanResult> {
    const errors: string[] = []
    const empty: ScanResult = {
      detection,
      agents: [],
      skills: [],
      plugins: [],
      commands: [],
      hooks: [],
      mcpServers: [],
      settings: null,
      errors,
    }
    if (!detection.present) return empty

    const root = detection.root

    const agents = [
      ...this.scanAgentsInDir(join(root, 'agents'), errors),
      ...this.scanMarketplaceAgents(join(root, 'plugins', 'marketplaces'), errors),
    ]

    const skills = [
      ...this.scanSkillsInDir(join(root, 'skills'), errors),
      ...this.scanMarketplaceSkills(join(root, 'plugins', 'marketplaces'), errors),
    ]

    const commands = [
      ...this.scanCommandsInDir(join(root, 'commands'), errors),
      ...this.scanMarketplaceCommands(join(root, 'plugins', 'marketplaces'), errors),
    ]

    const hooks = this.scanHooksInDir(join(root, 'hooks'), errors)
    const plugins = this.scanInstalledPlugins(root, errors)
    const mcpServers = this.scanMcpServers(root, errors)
    const settings = this.scanSettings(root, errors)

    return {
      detection,
      agents,
      skills,
      plugins,
      commands,
      hooks,
      mcpServers,
      settings,
      errors,
    }
  }

  // ── agents ──────────────────────────────────────────────────────────────

  private scanAgentsInDir(dir: string, errors: string[]): Asset[] {
    if (!existsSync(dir)) return []
    const out: Asset[] = []
    for (const entry of safeReaddir(dir, errors)) {
      if (!entry.endsWith('.md')) continue
      const path = join(dir, entry)
      try {
        const raw = readFileSync(path, 'utf-8')
        const { data, content } = matter(raw)
        out.push(
          buildAsset({
            agentKind: KIND,
            kind: 'agent',
            name: typeof data.name === 'string' ? data.name : basename(entry, '.md'),
            description: typeof data.description === 'string' ? data.description : undefined,
            model: typeof data.model === 'string' ? data.model : undefined,
            tools: asStringArray(data.tools),
            sourcePath: path,
            raw,
            parsed: { frontmatter: data, body: content },
          }),
        )
      } catch (e) {
        errors.push(`agent parse failed: ${path} — ${(e as Error).message}`)
      }
    }
    return out
  }

  private scanMarketplaceAgents(dir: string, errors: string[]): Asset[] {
    if (!existsSync(dir)) return []
    const out: Asset[] = []
    for (const mkt of safeReaddir(dir, errors)) {
      const agentsDir = join(dir, mkt, 'agents')
      if (existsSync(agentsDir)) {
        out.push(...this.scanAgentsInDir(agentsDir, errors))
      }
    }
    return out
  }

  // ── skills ──────────────────────────────────────────────────────────────

  private scanSkillsInDir(dir: string, errors: string[]): Asset[] {
    if (!existsSync(dir)) return []
    const out: Asset[] = []
    for (const entry of safeReaddir(dir, errors)) {
      const skillDir = join(dir, entry)
      if (!safeIsDir(skillDir)) continue
      const skillFile = join(skillDir, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      try {
        const raw = readFileSync(skillFile, 'utf-8')
        const { data, content } = matter(raw)
        out.push(
          buildAsset({
            agentKind: KIND,
            kind: 'skill',
            name: typeof data.name === 'string' ? data.name : entry,
            description: typeof data.description === 'string' ? data.description : undefined,
            sourcePath: skillFile,
            raw,
            parsed: { frontmatter: data, body: content, dir: skillDir },
          }),
        )
      } catch (e) {
        errors.push(`skill parse failed: ${skillFile} — ${(e as Error).message}`)
      }
    }
    return out
  }

  private scanMarketplaceSkills(dir: string, errors: string[]): Asset[] {
    if (!existsSync(dir)) return []
    const out: Asset[] = []
    for (const mkt of safeReaddir(dir, errors)) {
      const skillsDir = join(dir, mkt, 'skills')
      if (existsSync(skillsDir)) {
        out.push(...this.scanSkillsInDir(skillsDir, errors))
      }
    }
    return out
  }

  // ── commands ────────────────────────────────────────────────────────────

  private scanCommandsInDir(dir: string, errors: string[]): Asset[] {
    if (!existsSync(dir)) return []
    const out: Asset[] = []
    for (const entry of safeReaddir(dir, errors)) {
      if (!entry.endsWith('.md')) continue
      const path = join(dir, entry)
      try {
        const raw = readFileSync(path, 'utf-8')
        const { data, content } = matter(raw)
        out.push(
          buildAsset({
            agentKind: KIND,
            kind: 'command',
            name: basename(entry, '.md'),
            description: typeof data.description === 'string' ? data.description : undefined,
            sourcePath: path,
            raw,
            parsed: { frontmatter: data, body: content },
          }),
        )
      } catch (e) {
        errors.push(`command parse failed: ${path} — ${(e as Error).message}`)
      }
    }
    return out
  }

  private scanMarketplaceCommands(dir: string, errors: string[]): Asset[] {
    if (!existsSync(dir)) return []
    const out: Asset[] = []
    for (const mkt of safeReaddir(dir, errors)) {
      const cmdDir = join(dir, mkt, 'commands')
      if (existsSync(cmdDir)) {
        out.push(...this.scanCommandsInDir(cmdDir, errors))
      }
    }
    return out
  }

  // ── hooks ───────────────────────────────────────────────────────────────

  private scanHooksInDir(dir: string, errors: string[]): Asset[] {
    if (!existsSync(dir)) return []
    const out: Asset[] = []
    for (const entry of safeReaddir(dir, errors)) {
      const path = join(dir, entry)
      if (!safeIsFile(path)) continue
      try {
        const raw = readFileSync(path, 'utf-8')
        out.push(
          buildAsset({
            agentKind: KIND,
            kind: 'hook',
            name: entry,
            sourcePath: path,
            raw,
            parsed: { script: raw.length > 4096 ? raw.slice(0, 4096) + '…' : raw },
          }),
        )
      } catch (e) {
        errors.push(`hook read failed: ${path} — ${(e as Error).message}`)
      }
    }
    return out
  }

  // ── plugins ─────────────────────────────────────────────────────────────

  private scanInstalledPlugins(root: string, errors: string[]): Asset[] {
    const manifestPath = join(root, 'plugins', 'installed_plugins.json')
    if (!existsSync(manifestPath)) return []
    try {
      const raw = readFileSync(manifestPath, 'utf-8')
      const json = JSON.parse(raw) as {
        plugins?: Record<string, Array<Record<string, unknown>>>
      }
      const out: Asset[] = []
      for (const [pluginKey, instances] of Object.entries(json.plugins ?? {})) {
        for (const inst of instances) {
          const installPath = String(inst.installPath ?? '')
          out.push(
            buildAsset({
              agentKind: KIND,
              kind: 'plugin',
              name: pluginKey,
              description:
                typeof inst.scope === 'string'
                  ? `scope=${inst.scope} version=${inst.version ?? '?'}`
                  : undefined,
              sourcePath: installPath || manifestPath,
              raw: JSON.stringify(inst),
              parsed: inst,
            }),
          )
        }
      }
      return out
    } catch (e) {
      errors.push(`plugins manifest parse failed: ${(e as Error).message}`)
      return []
    }
  }

  // ── MCP ─────────────────────────────────────────────────────────────────

  private scanMcpServers(root: string, errors: string[]): McpServer[] {
    const candidates: string[] = []
    const mktDir = join(root, 'plugins', 'marketplaces')
    if (existsSync(mktDir)) {
      for (const mkt of safeReaddir(mktDir, errors)) {
        candidates.push(join(mktDir, mkt, 'mcp-configs', 'mcp-servers.json'))
        candidates.push(join(mktDir, mkt, '.mcp.json'))
      }
    }
    candidates.push(join(root, 'mcp-servers.json'))
    candidates.push(join(root, '.mcp.json'))

    const out: McpServer[] = []
    const seen = new Set<string>()
    for (const path of candidates) {
      if (!existsSync(path)) continue
      try {
        const raw = readFileSync(path, 'utf-8')
        const json = JSON.parse(raw) as { mcpServers?: Record<string, Record<string, unknown>> }
        const map = json.mcpServers ?? {}
        for (const [name, def] of Object.entries(map)) {
          const key = `${name}@${path}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({
            agentKind: KIND,
            name,
            command: typeof def.command === 'string' ? def.command : undefined,
            args: Array.isArray(def.args)
              ? def.args.filter((v): v is string => typeof v === 'string')
              : undefined,
            env:
              def.env && typeof def.env === 'object' && !Array.isArray(def.env)
                ? (def.env as Record<string, string>)
                : undefined,
            type:
              def.type === 'http' || def.type === 'sse' || def.type === 'stdio'
                ? def.type
                : def.url
                  ? 'http'
                  : 'stdio',
            url: typeof def.url === 'string' ? def.url : undefined,
            sourcePath: path,
          })
        }
      } catch (e) {
        errors.push(`mcp parse failed: ${path} — ${(e as Error).message}`)
      }
    }
    return out
  }

  // ── settings ────────────────────────────────────────────────────────────

  private scanSettings(root: string, errors: string[]): Asset | null {
    const path = join(root, 'settings.json')
    if (!existsSync(path)) return null
    try {
      const raw = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(raw)
      return buildAsset({
        agentKind: KIND,
        kind: 'settings',
        name: 'settings.json',
        sourcePath: path,
        raw,
        parsed,
      })
    } catch (e) {
      errors.push(`settings parse failed: ${(e as Error).message}`)
      return null
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function safeReaddir(dir: string, errors: string[]): string[] {
  try {
    return readdirSync(dir)
  } catch (e) {
    errors.push(`readdir failed: ${dir} — ${(e as Error).message}`)
    return []
  }
}

function safeIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
