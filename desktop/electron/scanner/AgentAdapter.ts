import type { AgentDetection, ScanResult } from '../../../shared/types'

export interface AgentAdapter {
  readonly kind: AgentDetection['kind']
  detect(): Promise<AgentDetection>
  scan(detection: AgentDetection): Promise<ScanResult>
}
