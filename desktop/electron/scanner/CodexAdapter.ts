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

const KIND = 'codex' as const

interface CodexConfig {
  model?: string
  model_reasoning_effort?: string
  approval_policy?: string
  sandbox_mode?: string
  web_search?: string
  notify?: unknown
  persistent_instructions?: string
  mcp_servers?: Record<string, Record<string, unknown>>
  agents?: Record<string, Record<string, unknown>> & {
    max_threads?: number
    max_depth?: number
  }
  plugins?: Record<string, Record<string, unknown>>
  profiles?: Record<string, Record<string, unknown>>
  projects?: Record<string, Record<string, unknown>>
  features?: Record<string, unknown>
  [k: string]: unknown
}

export class CodexAdapter implements AgentAdapter {
  readonly kind = KIND

  async detect(ctx?: ScanContext): Promise<AgentDetection> {
    const home = ctx?.homeDir ?? homedir()
    const root = join(home, '.codex')
    const present = existsSync(root) && existsSync(join(root, 'config.toml'))
    let version: string | undefined
    if (present) {
      try {
        const v = JSON.parse(readFileSync(join(root, 'version.json'), 'utf-8'))
        version = typeof v?.version === 'string' ? v.version : undefined
      } catch {
        // ignore — version.json is optional
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
    const configPath = join(root, 'config.toml')
    let config: CodexConfig = {}
    let configRaw = ''
    try {
      configRaw = readFileSync(configPath, 'utf-8')
      config = TOML.parse(configRaw) as CodexConfig
    } catch (e) {
      errors.push(`config.toml parse failed: ${(e as Error).message}`)
      return empty
    }

    const agents = [
      ...this.extractAgentsFromConfig(config, configPath, root, errors),
      ...this.scanLocalAgentDir(join(root, 'agents'), errors),
    ]

    const skills = this.scanSkillsInDir(join(root, 'skills'), errors)
    const commands = this.scanRulesInDir(join(root, 'rules'), errors)
    const plugins = this.extractPlugins(config, configPath)
    const mcpServers = this.extractMcpServers(config, configPath)
    const settings = this.buildSettingsAsset(config, configRaw, configPath)

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

  // ── agents ──────────────────────────────────────────────────────────────

  private extractAgentsFromConfig(
    config: CodexConfig,
    configPath: string,
    root: string,
    errors: string[],
  ): Asset[] {
    const out: Asset[] = []
    const agentsBlock = config.agents ?? {}
    for (const [name, def] of Object.entries(agentsBlock)) {
      // Skip non-object entries (max_threads / max_depth / etc.)
      if (typeof def !== 'object' || Array.isArray(def) || def == null) continue
      const description =
        typeof (def as Record<string, unknown>).description === 'string'
          ? ((def as Record<string, unknown>).description as string)
          : undefined
      const configFile = (def as Record<string, unknown>).config_file
      let resolvedPath = configPath
      let parsed: Record<string, unknown> = def as Record<string, unknown>

      if (typeof configFile === 'string') {
        const candidates = [
          join(dirname(configPath), configFile),
          join(root, configFile),
          join(root, '.codex', configFile),
        ]
        const found = candidates.find((p) => existsSync(p))
        if (found) {
          try {
            const raw = readFileSync(found, 'utf-8')
            parsed = { ...(def as Record<string, unknown>), file: TOML.parse(raw) }
            resolvedPath = found
          } catch (e) {
            errors.push(`agent file parse failed: ${found} — ${(e as Error).message}`)
          }
        }
      }

      out.push(
        buildAsset({
          agentKind: KIND,
          kind: 'agent',
          name,
          description,
          model: typeof (parsed as { model?: unknown }).model === 'string'
            ? ((parsed as { model: string }).model)
            : typeof (parsed as { file?: { model?: unknown } }).file?.model === 'string'
              ? ((parsed as { file: { model: string } }).file.model)
              : undefined,
          sourcePath: resolvedPath,
          raw: JSON.stringify(parsed, null, 2),
          parsed,
        }),
      )
    }
    return out
  }

  private scanLocalAgentDir(dir: string, errors: string[]): Asset[] {
    if (!existsSync(dir)) return []
    const out: Asset[] = []
    for (const entry of safeReaddir(dir, errors)) {
      if (!entry.endsWith('.toml')) continue
      const path = join(dir, entry)
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
        errors.push(`codex agent toml parse failed: ${path} — ${(e as Error).message}`)
      }
    }
    return out
  }

  // ── skills (mirrored Claude Code pattern; usually empty for Codex) ─────

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
        out.push(
          buildAsset({
            agentKind: KIND,
            kind: 'skill',
            name: entry,
            sourcePath: skillFile,
            raw,
            parsed: { body: raw, dir: skillDir },
          }),
        )
      } catch (e) {
        errors.push(`codex skill read failed: ${skillFile} — ${(e as Error).message}`)
      }
    }
    return out
  }

  private scanRulesInDir(dir: string, errors: string[]): Asset[] {
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
            kind: 'command',
            name: entry,
            sourcePath: path,
            raw,
            parsed: { body: raw },
          }),
        )
      } catch (e) {
        errors.push(`codex rule read failed: ${path} — ${(e as Error).message}`)
      }
    }
    return out
  }

  // ── plugins ─────────────────────────────────────────────────────────────

  private extractPlugins(config: CodexConfig, configPath: string): Asset[] {
    const out: Asset[] = []
    for (const [name, def] of Object.entries(config.plugins ?? {})) {
      out.push(
        buildAsset({
          agentKind: KIND,
          kind: 'plugin',
          name,
          description: def && typeof def === 'object' && 'enabled' in def
            ? `enabled=${String((def as { enabled: unknown }).enabled)}`
            : undefined,
          sourcePath: configPath,
          raw: JSON.stringify(def, null, 2),
          parsed: def as Record<string, unknown>,
        }),
      )
    }
    return out
  }

  // ── MCP ─────────────────────────────────────────────────────────────────

  private extractMcpServers(config: CodexConfig, configPath: string): McpServer[] {
    const out: McpServer[] = []
    for (const [name, def] of Object.entries(config.mcp_servers ?? {})) {
      const command = typeof def.command === 'string' ? (def.command as string) : undefined
      const args = Array.isArray(def.args)
        ? (def.args as unknown[]).filter((v): v is string => typeof v === 'string')
        : undefined
      const env =
        def.env && typeof def.env === 'object' && !Array.isArray(def.env)
          ? (def.env as Record<string, string>)
          : undefined
      const url = typeof def.url === 'string' ? (def.url as string) : undefined
      out.push({
        agentKind: KIND,
        name,
        command,
        args,
        env,
        type: url ? 'http' : 'stdio',
        url,
        sourcePath: configPath,
      })
    }
    return out
  }

  // ── settings ────────────────────────────────────────────────────────────

  private buildSettingsAsset(
    config: CodexConfig,
    raw: string,
    path: string,
  ): Asset {
    return buildAsset({
      agentKind: KIND,
      kind: 'settings',
      name: 'config.toml',
      sourcePath: path,
      raw,
      parsed: config,
    })
  }
}

// helpers ────────────────────────────────────────────────────────────────

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
