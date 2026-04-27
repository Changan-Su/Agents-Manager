export type AgentKind = 'claude-code' | 'codex' | 'opencode' | 'openclaw'

export type AssetKind =
  | 'agent'
  | 'skill'
  | 'plugin'
  | 'command'
  | 'hook'
  | 'mcp'
  | 'settings'

export interface Asset {
  id: string
  agentKind: AgentKind
  kind: AssetKind
  name: string
  description?: string
  model?: string
  tools?: string[]
  mode?: 'primary' | 'subagent'
  sourcePath: string
  rawHash: string
  parsed: Record<string, unknown>
}

export interface McpServer {
  name: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  type?: 'stdio' | 'http' | 'sse'
  url?: string
  agentKind: AgentKind
  sourcePath: string
}

export interface AgentDetection {
  kind: AgentKind
  present: boolean
  root: string
  version?: string
}

export interface ScanResult {
  detection: AgentDetection
  agents: Asset[]
  skills: Asset[]
  plugins: Asset[]
  commands: Asset[]
  hooks: Asset[]
  mcpServers: McpServer[]
  settings: Asset | null
  errors: string[]
}

export interface AgentSummary {
  kind: AgentKind
  present: boolean
  root: string
  counts: {
    agents: number
    skills: number
    plugins: number
    commands: number
    hooks: number
    mcpServers: number
  }
  errors: string[]
}

export interface ScanResponse {
  scanId: string
  startedAt: number
  finishedAt: number
  agents: AgentSummary[]
}

export interface AssetReadResponse {
  raw: string
  parsed: Asset
  sourcePath: string
}
