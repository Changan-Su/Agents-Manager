import { create } from 'zustand'
import type { RepositoryItem, RepositoryKind } from '@shared/types'

interface RepositoryState {
  items: RepositoryItem[]
  loading: boolean
  error: string | null
  refresh: (kind?: RepositoryKind) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useRepositoryStore = create<RepositoryState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  async refresh(kind) {
    set({ loading: true, error: null })
    try {
      const items = await window.api.repository.list(kind)
      set({ items, loading: false })
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  async remove(id) {
    try {
      await window.api.repository.delete(id)
      await get().refresh()
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },
}))
