import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AgentAdapter } from './AgentAdapter'
import type { AgentDetection, ScanResult } from '../../../shared/types'

// Sprint 2 will fill in TOML parsing for ~/.codex/config.toml + .codex/agents/*.toml
export class CodexAdapter implements AgentAdapter {
  readonly kind = 'codex' as const

  async detect(): Promise<AgentDetection> {
    const root = join(homedir(), '.codex')
    const present = existsSync(root) && existsSync(join(root, 'config.toml'))
    return { kind: this.kind, present, root }
  }

  async scan(detection: AgentDetection): Promise<ScanResult> {
    return {
      detection,
      agents: [],
      skills: [],
      plugins: [],
      commands: [],
      hooks: [],
      mcpServers: [],
      settings: null,
      errors: detection.present ? ['Codex adapter: scan not yet implemented (Sprint 2)'] : [],
    }
  }
}
