import { create } from 'zustand'
import type { AgentSummary } from '@shared/types'

interface ScanState {
  running: boolean
  lastScanAt: number | null
  agents: AgentSummary[]
  error: string | null
  runScan: () => Promise<void>
  loadCached: () => Promise<void>
}

export const useScanStore = create<ScanState>((set) => ({
  running: false,
  lastScanAt: null,
  agents: [],
  error: null,

  async runScan() {
    set({ running: true, error: null })
    try {
      const result = await window.api.scan.run()
      set({
        running: false,
        agents: result.agents,
        lastScanAt: result.finishedAt,
      })
    } catch (e) {
      set({ running: false, error: (e as Error).message })
    }
  },

  async loadCached() {
    try {
      const summary = await window.api.scan.lastSummary()
      if (summary) set({ agents: summary })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },
}))
