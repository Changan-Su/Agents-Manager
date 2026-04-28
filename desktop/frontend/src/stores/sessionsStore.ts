import { create } from 'zustand'
import type { ClaudeSession, ProcessRow, SessionListPayload } from '@shared/types'

interface SessionsState {
  claude: ClaudeSession[]
  processes: ProcessRow[]
  generatedAt: number | null
  unsubscribe: (() => void) | null
  start: () => void
  stop: () => void
  refresh: () => Promise<void>
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  claude: [],
  processes: [],
  generatedAt: null,
  unsubscribe: null,

  start() {
    if (get().unsubscribe) return
    void get().refresh()
    const off = window.api.sessions.onUpdate((payload: SessionListPayload) => {
      set({
        claude: payload.claude,
        processes: payload.processes,
        generatedAt: payload.generatedAt,
      })
    })
    set({ unsubscribe: off })
  },

  stop() {
    const off = get().unsubscribe
    if (off) off()
    set({ unsubscribe: null })
  },

  async refresh() {
    try {
      const payload = await window.api.sessions.list()
      set({
        claude: payload.claude,
        processes: payload.processes,
        generatedAt: payload.generatedAt,
      })
    } catch {
      // ignored — session listing is non-essential
    }
  },
}))
