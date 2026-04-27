import type { AgentAdapter } from './AgentAdapter'
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
import { CodexAdapter } from './CodexAdapter'
import { OpenCodeAdapter } from './OpenCodeAdapter'
import { OpenClawAdapter } from './OpenClawAdapter'

export const adapters: AgentAdapter[] = [
  new ClaudeCodeAdapter(),
  new CodexAdapter(),
  new OpenCodeAdapter(),
  new OpenClawAdapter(),
]
