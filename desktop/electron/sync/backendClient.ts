import { Buffer } from 'node:buffer'

export interface SnapshotMeta {
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

export interface MachineMeta {
  machineId: string
  label: string
  os: string | null
  firstSeenAt: number
  lastSeenAt: number
}

export interface RepositoryItemMeta {
  id: string
  kind: string
  name: string
  version: string | null
  blobId: string
  manifest: {
    files: Array<{ archivePath: string; sizeBytes: number; mode?: number }>
    description?: string
    encryption?: { algorithm: string; kdf?: string; saltB64?: string }
    clientVersion?: string
  }
  createdAt: number
  updatedAt: number
}

export interface HealthInfo {
  ok: boolean
  version: string
  auth: string
  storage: string
  machines: number
  snapshots: number
}

export class BackendClient {
  constructor(
    public baseUrl: string,
    private apiKey: string | null,
    private machineId: string | null,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra }
    if (this.apiKey) h['X-Api-Key'] = this.apiKey
    if (this.machineId) h['X-Machine-Id'] = this.machineId
    return h
  }

  async health(): Promise<HealthInfo> {
    const res = await fetch(`${this.baseUrl}/api/health`)
    if (!res.ok) throw new Error(`health ${res.status}`)
    return res.json() as Promise<HealthInfo>
  }

  // Probe an authenticated endpoint to confirm the API key is valid for this
  // server. Cheaper than uploading anything; returns 200 on success.
  async verifyKey(): Promise<{ ok: true } | never> {
    const res = await fetch(`${this.baseUrl}/api/snapshots?limit=1`, {
      headers: this.headers(),
    })
    if (res.status === 401) {
      throw new Error('invalid API key')
    }
    if (!res.ok) {
      throw new Error(`verify ${res.status}: ${await res.text()}`)
    }
    return { ok: true }
  }

  async uploadBlob(buffer: Buffer): Promise<{ blobId: string; sizeBytes: number; sha256: string }> {
    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' })
    const form = new FormData()
    form.append('file', blob, 'snapshot.bin.enc')
    const res = await fetch(`${this.baseUrl}/api/blobs`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    })
    if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`)
    return res.json() as Promise<{ blobId: string; sizeBytes: number; sha256: string }>
  }

  async downloadBlob(blobId: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/api/blobs/${encodeURIComponent(blobId)}`, {
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`download ${res.status}`)
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  }

  async deleteBlob(blobId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/blobs/${encodeURIComponent(blobId)}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`delete blob ${res.status}: ${await res.text()}`)
    }
  }

  async createSnapshot(body: {
    blobId: string
    machineId: string
    machineLabel: string
    os?: string
    manifest: SnapshotMeta['manifest']
    sizeBytes: number
  }): Promise<{ id: string; createdAt: number }> {
    return this.postJson('/api/snapshots', body)
  }

  async listSnapshots(machineId?: string, limit?: number): Promise<{ snapshots: SnapshotMeta[] }> {
    const params = new URLSearchParams()
    if (machineId) params.set('machineId', machineId)
    if (limit) params.set('limit', String(limit))
    const q = params.toString()
    return this.getJson(`/api/snapshots${q ? '?' + q : ''}`)
  }

  async getSnapshot(snapshotId: string): Promise<SnapshotMeta> {
    return this.getJson(`/api/snapshots/${encodeURIComponent(snapshotId)}`)
  }

  async deleteSnapshot(snapshotId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/snapshots/${encodeURIComponent(snapshotId)}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`delete ${res.status}`)
    return res.json() as Promise<{ ok: boolean }>
  }

  async listMachines(): Promise<{ machines: MachineMeta[] }> {
    return this.getJson('/api/machines')
  }

  // ── Repository ─────────────────────────────────────────────────────────

  async listRepository(kind?: string): Promise<{ items: RepositoryItemMeta[] }> {
    const q = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    return this.getJson(`/api/repository${q}`)
  }

  async upsertRepositoryItem(body: {
    id?: string
    kind: string
    name: string
    version?: string
    blobId: string
    manifest: RepositoryItemMeta['manifest']
  }): Promise<RepositoryItemMeta> {
    return this.postJson('/api/repository', body)
  }

  async getRepositoryItem(id: string): Promise<RepositoryItemMeta> {
    return this.getJson(`/api/repository/${encodeURIComponent(id)}`)
  }

  async deleteRepositoryItem(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/repository/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`delete repo ${res.status}`)
    return res.json() as Promise<{ ok: boolean }>
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() })
    if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }
}
