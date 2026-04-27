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

interface AuthResponse {
  token: string
  user: { id: string; email: string; role: string }
}

export class BackendClient {
  constructor(
    public baseUrl: string,
    private token: string | null = null,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  setToken(token: string | null) {
    this.token = token
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra }
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  async health(): Promise<{ ok: boolean; version: string; storage: string; users: number; snapshots: number }> {
    const res = await fetch(`${this.baseUrl}/api/health`)
    if (!res.ok) throw new Error(`health ${res.status}`)
    return res.json() as Promise<{ ok: boolean; version: string; storage: string; users: number; snapshots: number }>
  }

  async register(email: string, password: string): Promise<AuthResponse> {
    const r = await this.postJson<AuthResponse>('/api/auth/register', { email, password })
    this.token = r.token
    return r
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const r = await this.postJson<AuthResponse>('/api/auth/login', { email, password })
    this.token = r.token
    return r
  }

  async me(): Promise<{ id: string; email: string; role: string }> {
    return this.getJson('/api/auth/me')
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
