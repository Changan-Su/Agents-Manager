import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { homedir } from 'node:os'
import TOML from '@iarna/toml'
import type { AgentAdapter, ScanContext } from './AgentAdapter'
import type {
  Asset,
  McpServer,
  AgentDetection,
  ScanResult,
} from '../../../shared/types'
import { buildAsset } from './normalize'

const KIND = 'opencode' as const

interface OpenCodeJson {
  $schema?: string
  model?: string
  small_model?: string
  default_agent?: string
  instructions?: string[]
  plugin?: string[]
  agent?: Record<string, OpenCodeAgentDef>
  command?: Record<string, OpenCodeCommandDef>
  permission?: Record<string, string>
  mcpServers?: Record<string, Record<string, unknown>>
  [k: string]: unknown
}

interface OpenCodeAgentDef {
  description?: string
  mode?: 'primary' | 'subagent' | string
  model?: string
  prompt?: string
  tools?: Record<string, boolean>
}

interface OpenCodeCommandDef {
  description?: string
  template?: string
  agent?: string
  subtask?: boolean
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly kind = KIND

  async detect(ctx?: ScanContext): Promise<AgentDetection> {
    const home = ctx?.homeDir ?? homedir()
    const candidates = this.candidateRoots(home)
    let root = candidates.find((p) => existsSync(join(p, 'opencode.json')))
    if (!root) {
      // Fall back to discovered marketplace `.opencode/` bundles so users see
      // template configs that ship alongside their Claude Code plugins.
      const marketplaces = join(home, '.claude', 'plugins', 'marketplaces')
      if (existsSync(marketplaces)) {
        for (const mkt of safeReaddir(marketplaces, [])) {
          const candidate = join(marketplaces, mkt, '.opencode')
          if (existsSync(join(candidate, 'opencode.json'))) {
            root = candidate
            break
          }
        }
      }
    }
    const finalRoot = root ?? candidates[0]
    const present = existsSync(join(finalRoot, 'opencode.json'))
    return { kind: KIND, present, root: finalRoot }
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

    const configPath = join(detection.root, 'opencode.json')
    let config: OpenCodeJson = {}
    let raw = ''
    try {
      raw = readFileSync(configPath, 'utf-8')
      config = JSON.parse(raw) as OpenCodeJson
    } catch (e) {
      errors.push(`opencode.json parse failed: ${(e as Error).message}`)
      return empty
    }

    const agents = this.extractAgents(config, configPath)
    const commands = this.extractCommands(config, configPath)
    const plugins = this.extractPlugins(config, configPath, detection.root, errors)
    const skills = this.resolveSkills(config, detection.root, errors)
    const mcpServers = this.extractMcpServers(config, configPath)
    const settings = buildAsset({
      agentKind: KIND,
      kind: 'settings',
      name: 'opencode.json',
      sourcePath: configPath,
      raw,
      parsed: config as Record<string, unknown>,
    })

    return {
      detection,
      agents,
      skills,
      plugins,
      commands,
      hooks: [],
      mcpServers,
      settings,
      errors,
    }
  }

  private candidateRoots(home: string): string[] {
    return [
      join(home, '.opencode'),
      join(home, '.config', 'opencode'),
    ]
  }

  // ── agents ──────────────────────────────────────────────────────────────

  private extractAgents(config: OpenCodeJson, configPath: string): Asset[] {
    const out: Asset[] = []
    for (const [name, def] of Object.entries(config.agent ?? {})) {
      const tools = def.tools
        ? Object.entries(def.tools).filter(([, v]) => v).map(([k]) => k)
        : undefined
      const mode: 'primary' | 'subagent' | undefined =
        def.mode === 'primary' ? 'primary' : def.mode === 'subagent' ? 'subagent' : undefined
      out.push(
        buildAsset({
          agentKind: KIND,
          kind: 'agent',
          name,
          description: def.description,
          model: def.model,
          tools,
          mode,
          sourcePath: configPath,
          raw: JSON.stringify(def, null, 2),
          parsed: def as unknown as Record<string, unknown>,
        }),
      )
    }
    return out
  }

  // ── commands ────────────────────────────────────────────────────────────

  private extractCommands(config: OpenCodeJson, configPath: string): Asset[] {
    const out: Asset[] = []
    for (const [name, def] of Object.entries(config.command ?? {})) {
      out.push(
        buildAsset({
          agentKind: KIND,
          kind: 'command',
          name,
          description: def.description,
          sourcePath: configPath,
          raw: JSON.stringify(def, null, 2),
          parsed: def as unknown as Record<string, unknown>,
        }),
      )
    }
    return out
  }

  // ── plugins ─────────────────────────────────────────────────────────────

  private extractPlugins(
    config: OpenCodeJson,
    configPath: string,
    root: string,
    errors: string[],
  ): Asset[] {
    const out: Asset[] = []
    for (const ref of config.plugin ?? []) {
      // ref is usually "./plugins" or a package name
      const resolved =
        ref.startsWith('./') || ref.startsWith('../')
          ? join(root, ref)
          : ref
      out.push(
        buildAsset({
          agentKind: KIND,
          kind: 'plugin',
          name: ref,
          description:
            (resolved.startsWith('/') && existsSync(resolved))
              ? `local: ${resolved}`
              : `package: ${ref}`,
          sourcePath: configPath,
          raw: JSON.stringify({ ref, resolved }),
          parsed: { ref, resolved },
        }),
      )
      // Surface a warning if the local plugin path is missing.
      if (resolved.startsWith('/') && !existsSync(resolved)) {
        errors.push(`opencode plugin path missing: ${resolved}`)
      }
    }
    return out
  }

  // ── skills (referenced via instructions[] paths) ────────────────────────

  private resolveSkills(
    config: OpenCodeJson,
    root: string,
    errors: string[],
  ): Asset[] {
    const out: Asset[] = []
    for (const rel of config.instructions ?? []) {
      // we treat any instructions/*/SKILL.md or skills/*/SKILL.md as a skill
      const path = join(root, rel)
      if (!existsSync(path)) continue
      const isSkill = rel.includes('/SKILL.md') || rel.endsWith('SKILL.md')
      if (!isSkill) continue
      try {
        const raw = readFileSync(path, 'utf-8')
        out.push(
          buildAsset({
            agentKind: KIND,
            kind: 'skill',
            name: basename(dirname(path)),
            sourcePath: path,
            raw,
            parsed: { body: raw },
          }),
        )
      } catch (e) {
        errors.push(`opencode skill read failed: ${path} — ${(e as Error).message}`)
      }
    }
    // Also auto-discover any agents/*.toml the marketplace shipped alongside opencode.json
    const agentsDir = join(root, 'agents')
    if (existsSync(agentsDir)) {
      for (const entry of safeReaddir(agentsDir, errors)) {
        if (!entry.endsWith('.toml')) continue
        const path = join(agentsDir, entry)
        try {
          const raw = readFileSync(path, 'utf-8')
          const parsed = TOML.parse(raw) as Record<string, unknown>
          out.push(
            buildAsset({
              agentKind: KIND,
              kind: 'agent',
              name: basename(entry, '.toml'),
              description:
                typeof parsed.description === 'string' ? parsed.description : undefined,
              model: typeof parsed.model === 'string' ? parsed.model : undefined,
              sourcePath: path,
              raw,
              parsed,
            }),
          )
        } catch (e) {
          errors.push(`opencode agents toml parse failed: ${path} — ${(e as Error).message}`)
        }
      }
    }
    return out
  }

  // ── MCP ─────────────────────────────────────────────────────────────────

  private extractMcpServers(config: OpenCodeJson, configPath: string): McpServer[] {
    const out: McpServer[] = []
    for (const [name, def] of Object.entries(config.mcpServers ?? {})) {
      out.push({
        agentKind: KIND,
        name,
        command: typeof def.command === 'string' ? (def.command as string) : undefined,
        args: Array.isArray(def.args)
          ? (def.args as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        env:
          def.env && typeof def.env === 'object' && !Array.isArray(def.env)
            ? (def.env as Record<string, string>)
            : undefined,
        type: typeof def.url === 'string' ? 'http' : 'stdio',
        url: typeof def.url === 'string' ? (def.url as string) : undefined,
        sourcePath: configPath,
      })
    }
    return out
  }
}

function safeReaddir(dir: string, errors: string[]): string[] {
  try {
    return readdirSync(dir)
  } catch (e) {
    errors.push(`readdir failed: ${dir} — ${(e as Error).message}`)
    return []
  }
}
