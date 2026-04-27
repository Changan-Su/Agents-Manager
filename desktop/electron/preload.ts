import { contextBridge, ipcRenderer } from 'electron'
import type {
  ScanResponse,
  AgentSummary,
  Asset,
  AssetReadResponse,
  McpServer,
} from '../../shared/types'

export interface BackupRow {
  id: string
  assetId: string
  beforeHash: string
  afterHash: string
  backupPath: string
  editedAt: number
}

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
    write: (
      assetId: string,
      content: string,
    ): Promise<{ editId: string; backupPath: string; beforeHash: string; afterHash: string }> =>
      ipcRenderer.invoke('asset:write', { assetId, content }),
    listBackups: (assetId: string): Promise<BackupRow[]> =>
      ipcRenderer.invoke('asset:listBackups', { assetId }),
    revert: (
      assetId: string,
      backupPath: string,
    ): Promise<{ editId: string; rollbackBackup: string }> =>
      ipcRenderer.invoke('asset:revert', { assetId, backupPath }),
    readBackup: (assetId: string, backupPath: string): Promise<{ raw: string }> =>
      ipcRenderer.invoke('asset:readBackup', { assetId, backupPath }),
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
  settings: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', { key }),
    set: (key: string, value: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('settings:set', { key, value }),
  },
  sync: {
    configure: (
      backendUrl: string,
    ): Promise<{ ok: boolean; health: { ok: boolean; version: string; storage: string; users: number; snapshots: number } }> =>
      ipcRenderer.invoke('sync:configure', { backendUrl }),
    login: (
      email: string,
      password: string,
    ): Promise<{ user: { id: string; email: string; role: string } }> =>
      ipcRenderer.invoke('sync:login', { email, password }),
    register: (
      email: string,
      password: string,
    ): Promise<{ user: { id: string; email: string; role: string } }> =>
      ipcRenderer.invoke('sync:register', { email, password }),
    logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('sync:logout'),
    status: (): Promise<{
      configured: boolean
      signedIn: boolean
      backendUrl?: string
      user?: { id: string; email: string; role: string }
      machineId?: string
      machineLabel?: string
      error?: string
    }> => ipcRenderer.invoke('sync:status'),
    push: (
      passphrase: string,
    ): Promise<{
      snapshotId: string
      blobId: string
      sizeBytes: number
      plainSizeBytes: number
      fileCount: number
    }> => ipcRenderer.invoke('sync:push', { passphrase }),
    list: (machineId?: string): Promise<SyncSnapshot[]> =>
      ipcRenderer.invoke('sync:list', { machineId }),
    listMachines: (): Promise<
      Array<{ machineId: string; label: string; os: string | null; firstSeenAt: number; lastSeenAt: number }>
    > => ipcRenderer.invoke('sync:listMachines'),
    pull: (
      snapshotId: string,
      passphrase: string,
    ): Promise<{ stagingDir: string; manifest: SyncSnapshot['manifest'] }> =>
      ipcRenderer.invoke('sync:pull', { snapshotId, passphrase }),
    apply: (
      stagingDir: string,
      targets: Array<{ archiveRel: string; absPath: string }>,
    ): Promise<{
      applied: Array<{ archiveRel: string; absPath: string; backupPath?: string }>
      errors: string[]
    }> => ipcRenderer.invoke('sync:apply', { stagingDir, targets }),
    delete: (snapshotId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('sync:delete', { snapshotId }),
  },
}

export interface SyncSnapshot {
  id: string
  machineId: string
  blobId: string
  manifest: {
    agentInventory: Array<{ kind: string; counts: Record<string, number>; version?: string }>
    encryption?: { algorithm: string; kdf?: string; saltB64?: string }
    clientVersion?: string
    createdAt: number
  }
  sizeBytes: number
  createdAt: number
}

contextBridge.exposeInMainWorld('api', api)

export type AgentsManagerApi = typeof api
declare global {
  interface Window {
    api: AgentsManagerApi
  }
}
