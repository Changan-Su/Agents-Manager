import type { AgentDetection, ScanResult } from '../../../shared/types'

export interface ScanContext {
  /** Override the home directory used to locate agent roots (e.g. for CLI/fixture testing). */
  homeDir?: string
}

export interface AgentAdapter {
  readonly kind: AgentDetection['kind']
  detect(ctx?: ScanContext): Promise<AgentDetection>
  scan(detection: AgentDetection, ctx?: ScanContext): Promise<ScanResult>
}
