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
  headers?: Record<string, string>
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

// ── Sessions ──────────────────────────────────────────────────────────────

export type SessionStatus = 'busy' | 'idle' | 'waiting' | 'dead'

export interface ClaudeSession {
  pid: number
  alive: boolean
  sessionId: string
  cwd: string
  startedAt: number
  updatedAt: number
  status: SessionStatus
  name?: string
  hasIdeBinding: boolean
  // Latest event types observed in the JSONL log, useful as a hint
  // about what the agent is doing without dumping full content.
  recentEventTypes?: string[]
}

export interface ProcessRow {
  pid: number
  agentKind: AgentKind | 'unknown'
  cwd: string | null
  command: string
  startedAt: number
}

export interface SessionListPayload {
  claude: ClaudeSession[]
  processes: ProcessRow[]
  generatedAt: number
}

export interface SessionEvent {
  ts: number
  type: string
  preview: string
}

export interface SessionTailResponse {
  sessionId: string
  events: SessionEvent[]
  truncated: boolean
}

// ── Repository ────────────────────────────────────────────────────────────

export type RepositoryKind = 'skill' | 'mcp_server' | 'command' | 'hook' | 'agent_def'

export interface RepositoryItem {
  id: string
  kind: RepositoryKind
  name: string
  version?: string
  description?: string
  storagePath: string  // absolute path to the item's content dir under userData
  manifest: {
    files: Array<{ relPath: string; sizeBytes: number }>
    primaryFile?: string  // e.g. SKILL.md for skill, .json for mcp_server
    mcpServerEntry?: {
      name: string
      command?: string
      args?: string[]
      env?: Record<string, string>
      type?: 'stdio' | 'http' | 'sse'
      url?: string
    }
  }
  deployedTo: Array<{
    deploymentId: string
    agentKind: AgentKind
    scope: 'user' | 'project'
    targetRoot: string
    targetPath: string  // primary path written
    deployedAt: number
  }>
  createdAt: number
  updatedAt: number
  remoteId?: string  // if synced to backend
}

export interface DeployTarget {
  agentKind: AgentKind
  scope: 'user' | 'project'
  projectPath?: string  // required when scope === 'project'
}

export interface DeployResult {
  applied: Array<{
    deploymentId: string
    agentKind: AgentKind
    scope: 'user' | 'project'
    targetPath: string
    backupPath?: string
  }>
  errors: string[]
}
