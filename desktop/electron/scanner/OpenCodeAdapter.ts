import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AgentAdapter } from './AgentAdapter'
import type { AgentDetection, ScanResult } from '../../../shared/types'

// Sprint 2 will fill in JSON+TOML parsing for ~/.opencode/opencode.json
export class OpenCodeAdapter implements AgentAdapter {
  readonly kind = 'opencode' as const

  async detect(): Promise<AgentDetection> {
    const candidates = [
      join(homedir(), '.opencode'),
      join(homedir(), '.config', 'opencode'),
    ]
    const root = candidates.find((p) => existsSync(p)) ?? candidates[0]
    const present = existsSync(join(root, 'opencode.json'))
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
      errors: detection.present ? ['OpenCode adapter: scan not yet implemented (Sprint 2)'] : [],
    }
  }
}
