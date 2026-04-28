import { ClaudeSessionWatcher } from './ClaudeSessionWatcher'
import { ProcessWatcher } from './ProcessWatcher'
import type { SessionListPayload } from '../../../shared/types'

let claudeWatcher: ClaudeSessionWatcher | null = null
let processWatcher: ProcessWatcher | null = null

export function startSessionWatchers(): void {
  if (!claudeWatcher) {
    claudeWatcher = new ClaudeSessionWatcher()
    claudeWatcher.start()
  }
  if (!processWatcher) {
    processWatcher = new ProcessWatcher()
    processWatcher.start()
  }
}

export function stopSessionWatchers(): void {
  claudeWatcher?.stop()
  processWatcher?.stop()
  claudeWatcher = null
  processWatcher = null
}

export function getClaudeWatcher(): ClaudeSessionWatcher {
  if (!claudeWatcher) throw new Error('claude session watcher not started')
  return claudeWatcher
}

export function getProcessWatcher(): ProcessWatcher {
  if (!processWatcher) throw new Error('process watcher not started')
  return processWatcher
}

export function snapshot(): SessionListPayload {
  return {
    claude: claudeWatcher?.list() ?? [],
    processes: processWatcher?.list() ?? [],
    generatedAt: Date.now(),
  }
}
