import { contextBridge, ipcRenderer } from 'electron'
import type {
  ScanResponse,
  AgentSummary,
  Asset,
  AssetReadResponse,
  McpServer,
  AgentKind,
  ClaudeSession,
  DeployResult,
  DeployTarget,
  ProcessRow,
  RepositoryItem,
  RepositoryKind,
  SessionListPayload,
  SessionTailResponse,
} from '../../shared/types'

export interface BackupRow {
  id: string
  assetId: string
  beforeHash: string
  afterHash: string
  backupPath: string
  editedAt: number
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

export interface BackendHealth {
  ok: boolean
  version: string
  auth: string
  storage: string
  machines: number
  snapshots: number
}

export interface SyncStatus {
  connected: boolean
  backendUrl?: string
  machineId: string
  machineLabel: string
  health?: BackendHealth
  error?: string
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
    connect: (
      backendUrl: string,
      apiKey: string,
    ): Promise<{ ok: boolean; health: BackendHealth; machineId: string }> =>
      ipcRenderer.invoke('sync:connect', { backendUrl, apiKey }),
    disconnect: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('sync:disconnect'),
    status: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:status'),
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
  sessions: {
    list: (): Promise<SessionListPayload> => ipcRenderer.invoke('sessions:list'),
    tail: (sessionId: string, lines?: number): Promise<SessionTailResponse> =>
      ipcRenderer.invoke('sessions:tail', { sessionId, lines }),
    onUpdate(cb: (payload: SessionListPayload) => void): () => void {
      const handler = (_evt: unknown, payload: SessionListPayload) => cb(payload)
      ipcRenderer.on('sessions:update', handler)
      return () => ipcRenderer.removeListener('sessions:update', handler)
    },
  },
  repository: {
    list: (kind?: RepositoryKind): Promise<RepositoryItem[]> =>
      ipcRenderer.invoke('repo:list', { kind }),
    get: (id: string): Promise<RepositoryItem | null> =>
      ipcRenderer.invoke('repo:get', { id }),
    read: (
      id: string,
    ): Promise<{
      item: RepositoryItem
      files: Array<{ relPath: string; content: string }>
    }> => ipcRenderer.invoke('repo:read', { id }),
    create: (payload: {
      kind: RepositoryKind
      name: string
      version?: string
      description?: string
      files: Array<{ relPath: string; content: string }>
      primaryFile?: string
      mcpServerEntry?: RepositoryItem['manifest']['mcpServerEntry']
    }): Promise<RepositoryItem> => ipcRenderer.invoke('repo:create', payload),
    update: (payload: {
      id: string
      name?: string
      version?: string
      description?: string
      files?: Array<{ relPath: string; content: string }>
      primaryFile?: string
      mcpServerEntry?: RepositoryItem['manifest']['mcpServerEntry']
    }): Promise<RepositoryItem> => ipcRenderer.invoke('repo:update', payload),
    delete: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('repo:delete', { id }),
    importFromAsset: (assetId: string): Promise<RepositoryItem> =>
      ipcRenderer.invoke('repo:importFromAsset', { assetId }),
    importMcp: (agentKind: AgentKind, name: string): Promise<RepositoryItem> =>
      ipcRenderer.invoke('repo:importMcp', { agentKind, name }),
    deploy: (id: string, targets: DeployTarget[]): Promise<DeployResult> =>
      ipcRenderer.invoke('repo:deploy', { id, targets }),
    undeploy: (
      id: string,
      deploymentId: string,
    ): Promise<{ ok: boolean; removed?: string; error?: string }> =>
      ipcRenderer.invoke('repo:undeploy', { id, deploymentId }),
  },
}

contextBridge.exposeInMainWorld('api', api)

// Re-export the types touched by the renderer.
export type { ClaudeSession, ProcessRow, SessionListPayload, SessionTailResponse, RepositoryItem, RepositoryKind, DeployTarget, DeployResult }

export type AgentsManagerApi = typeof api
declare global {
  interface Window {
    api: AgentsManagerApi
  }
}
