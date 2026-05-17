import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AgentAdapter, ScanContext } from './AgentAdapter'
import type { AgentDetection, ScanResult } from '../../../shared/types'

// v1 stub — no real OpenClaw install on target machines yet.
// Detects either ~/.openclaw or a SOUL.md-style root marker; otherwise no-ops gracefully.
export class OpenClawAdapter implements AgentAdapter {
  readonly kind = 'openclaw' as const

  async detect(ctx?: ScanContext): Promise<AgentDetection> {
    const home = ctx?.homeDir ?? homedir()
    const candidates = [join(home, '.openclaw'), join(home, '.config', 'openclaw')]
    const root = candidates.find((p) => existsSync(p)) ?? candidates[0]
    const present = existsSync(join(root, 'SOUL.md')) || existsSync(join(root, 'IDENTITY.md'))
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
      errors: detection.present
        ? ['OpenClaw adapter: detection succeeded but scan not yet implemented']
        : [],
    }
  }
}
