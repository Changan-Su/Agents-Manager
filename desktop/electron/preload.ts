import { contextBridge, ipcRenderer } from 'electron'
import type {
  ScanResponse,
  AgentSummary,
  Asset,
  AssetReadResponse,
  McpServer,
} from '../../shared/types'

const api = {
  scan: {
    run: (): Promise<ScanResponse> => ipcRenderer.invoke('scan:run'),
    lastSummary: (): Promise<AgentSummary[] | null> =>
      ipcRenderer.invoke('scan:lastSummary'),
  },
  asset: {
    list: (agentKind: string, kind?: string): Promise<Asset[]> =>
      ipcRenderer.invoke('asset:list', { agentKind, kind }),
    read: (assetId: string): Promise<AssetReadResponse> =>
      ipcRenderer.invoke('asset:read', { assetId }),
  },
  mcp: {
    list: (agentKind?: string): Promise<McpServer[]> =>
      ipcRenderer.invoke('mcp:list', { agentKind }),
  },
  fs: {
    openInFinder: (path: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('fs:openInFinder', { path }),
    openPath: (path: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:openPath', { path }),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type AgentsManagerApi = typeof api
declare global {
  interface Window {
    api: AgentsManagerApi
  }
}
