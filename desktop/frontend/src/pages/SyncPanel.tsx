import { useEffect, useState } from 'react'
import { StatusDot } from '../components/StatusDot'
import type { BackendHealth, SyncStatus } from '../../../electron/preload'

interface SyncSnapshot {
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [snapshots, setSnapshots] = useState<SyncSnapshot[]>([])
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pushResult, setPushResult] = useState<{ snapshotId: string; sizeBytes: number; fileCount: number } | null>(null)
  const [restorePreview, setRestorePreview] = useState<{ snapshotId: string; stagingDir: string } | null>(null)

  useEffect(() => {
    void refreshStatus()
  }, [])

  async function refreshStatus() {
    try {
      const s = await window.api.sync.status()
      setStatus(s)
      if (s.connected) {
        const list = await window.api.sync.list()
        setSnapshots(list)
      } else {
        setSnapshots([])
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function connect(backendUrl: string, apiKey: string) {
    setError(null)
    setInfo(null)
    try {
      await window.api.sync.connect(backendUrl, apiKey)
      setInfo(`Connected to ${backendUrl}`)
      await refreshStatus()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect this app from the backend?')) return
    await window.api.sync.disconnect()
    await refreshStatus()
    setInfo('Disconnected.')
  }

  async function push(passphrase: string) {
    setPushing(true)
    setError(null)
    setPushResult(null)
    try {
      const r = await window.api.sync.push(passphrase)
      setPushResult({
        snapshotId: r.snapshotId,
        sizeBytes: r.sizeBytes,
        fileCount: r.fileCount,
      })
      const list = await window.api.sync.list()
      setSnapshots(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPushing(false)
    }
  }

  async function pull(snap: SyncSnapshot, passphrase: string) {
    setPulling(true)
    setError(null)
    try {
      const { stagingDir } = await window.api.sync.pull(snap.id, passphrase)
      setRestorePreview({ snapshotId: snap.id, stagingDir })
      setInfo(
        `Snapshot decrypted to ${stagingDir}. Open the staging dir and copy what you need into the right agent root, or use the Apply flow.`,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPulling(false)
    }
  }

  async function deleteSnap(snap: SyncSnapshot) {
    if (!confirm(`Delete snapshot ${snap.id}? This is permanent.`)) return
    setError(null)
    try {
      await window.api.sync.delete(snap.id)
      const list = await window.api.sync.list()
      setSnapshots(list)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!status) return <div className="empty-state">Loading…</div>

  return (
    <div className="page-grid" style={{ maxWidth: 920 }}>
      <header className="page-header">
        <div>
          <h1>Sync</h1>
          <div className="page-header__sub">
            Snapshot your agent configs to a self-hosted backend, encrypted client-side with AES-256-GCM.
          </div>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {info ? (
        <div
          className="error-banner"
          style={{ background: 'var(--badge-b-bg)', color: 'var(--badge-b-fg)' }}
        >
          {info}
        </div>
      ) : null}

      {!status.connected ? (
        <ConnectForm
          existingUrl={status.backendUrl}
          machineId={status.machineId}
          machineLabel={status.machineLabel}
          onSubmit={connect}
          error={status.error}
        />
      ) : (
        <Connected
          status={status}
          snapshots={snapshots}
          pushing={pushing}
          pulling={pulling}
          onPush={push}
          onPull={pull}
          onDisconnect={disconnect}
          onDelete={deleteSnap}
        />
      )}

      {pushResult ? (
        <Card>
          <h3 style={{ margin: 0, fontSize: 14 }}>✓ Pushed</h3>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            Snapshot <code>{pushResult.snapshotId}</code> · {pushResult.fileCount} files ·{' '}
            {formatBytes(pushResult.sizeBytes)} encrypted
          </div>
        </Card>
      ) : null}

      {restorePreview ? (
        <Card>
          <h3 style={{ margin: 0, fontSize: 14 }}>Snapshot decrypted</h3>
          <div className="muted mono small" style={{ marginTop: 6 }}>
            {restorePreview.stagingDir}
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            The staging dir is organised as{' '}
            <code>&lt;agent-kind&gt;/&lt;original-relative-path&gt;</code>. Copy what you need
            back into the live agent root, or use the Apply flow once you've reviewed the files.
          </p>
          <button
            className="btn"
            onClick={() => window.api.fs.openPath(restorePreview.stagingDir)}
          >
            Open staging dir
          </button>
        </Card>
      ) : null}
    </div>
  )
}

// ── ConnectForm ─────────────────────────────────────────────────────────────

function ConnectForm({
  existingUrl,
  machineId,
  machineLabel,
  onSubmit,
  error,
}: {
  existingUrl?: string
  machineId: string
  machineLabel: string
  onSubmit: (url: string, key: string) => void | Promise<void>
  error?: string
}) {
  const [url, setUrl] = useState(existingUrl ?? 'http://localhost:8787')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    try {
      await onSubmit(url.trim(), apiKey.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h3 style={{ margin: 0, fontSize: 15 }}>Connect to backend</h3>
      <p className="muted small" style={{ marginTop: 6 }}>
        Paste the server's URL and the master API key (the value of{' '}
        <code>AGENTS_MANAGER_API_KEY</code> in the server's <code>.env</code>). Anyone
        with that key can read and write all snapshots, so treat it like an admin password.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        <input
          style={inputStyle}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-backend.example"
          autoFocus
        />
        <input
          style={inputStyle}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="X-Api-Key (≥32 chars)"
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn--primary" onClick={() => void go()} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
      {error ? <div className="error-banner" style={{ marginTop: 12 }}>{error}</div> : null}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-sub)' }}>
        <div className="asset-detail__meta-label">This machine</div>
        <div className="muted mono small">
          {machineLabel} · {machineId}
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          The machine ID is generated locally and sent as <code>X-Machine-Id</code> so the
          server can group your snapshots without you needing a user account.
        </p>
      </div>
    </Card>
  )
}

// ── Connected ──────────────────────────────────────────────────────────────

function Connected({
  status,
  snapshots,
  pushing,
  pulling,
  onPush,
  onPull,
  onDisconnect,
  onDelete,
}: {
  status: SyncStatus
  snapshots: SyncSnapshot[]
  pushing: boolean
  pulling: boolean
  onPush: (pass: string) => void
  onPull: (snap: SyncSnapshot, pass: string) => void
  onDisconnect: () => void
  onDelete: (snap: SyncSnapshot) => void
}) {
  const [passphrase, setPassphrase] = useState('')
  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusDot kind="ok" />
              <strong>Connected</strong>
              <span className="muted small mono">{status.backendUrl}</span>
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>
              Machine <span className="mono">{status.machineLabel}</span>{' '}
              ({status.machineId.slice(0, 8)}…)
              {status.health ? (
                <>
                  {' '}
                  · server {status.health.version} · {status.health.machines} machine
                  {status.health.machines === 1 ? '' : 's'} · {status.health.snapshots} snapshot
                  {status.health.snapshots === 1 ? '' : 's'}
                </>
              ) : null}
            </div>
          </div>
          <button className="btn" onClick={onDisconnect}>Disconnect</button>
        </div>
      </Card>

      <Card>
        <h3 style={{ margin: 0, fontSize: 15 }}>Push snapshot</h3>
        <p className="muted small" style={{ marginTop: 6 }}>
          Packs your detected agent configs into a tarball, encrypts with AES-256-GCM
          (passphrase via scrypt), then uploads.{' '}
          <strong style={{ color: 'var(--badge-red-fg)' }}>
            Forget the passphrase = lose the snapshot.
          </strong>
        </p>
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <input
            type="password"
            placeholder="passphrase (min 8 chars)"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            style={inputStyle}
          />
          <button
            className="btn btn--primary"
            disabled={pushing || passphrase.length < 8}
            onClick={() => onPush(passphrase)}
          >
            {pushing ? <span className="spinner" /> : null}
            {pushing ? 'Pushing…' : 'Push'}
          </button>
        </div>
      </Card>

      <Card>
        <h3 style={{ margin: 0, fontSize: 15 }}>Snapshots ({snapshots.length})</h3>
        {snapshots.length === 0 ? (
          <p className="muted small" style={{ marginTop: 6 }}>
            No snapshots yet. Push one to get started.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {snapshots.map((s) => (
              <SnapshotRow
                key={s.id}
                snapshot={s}
                isCurrentMachine={s.machineId === status.machineId}
                pulling={pulling}
                onPull={(pass) => onPull(s, pass)}
                onDelete={() => onDelete(s)}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

function SnapshotRow({
  snapshot,
  isCurrentMachine,
  pulling,
  onPull,
  onDelete,
}: {
  snapshot: SyncSnapshot
  isCurrentMachine: boolean
  pulling: boolean
  onPull: (passphrase: string) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pass, setPass] = useState('')
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--surface-sub)',
        border: '1px solid var(--border-sub)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {new Date(snapshot.createdAt).toLocaleString()}
            {isCurrentMachine ? (
              <span className="chip chip--green" style={{ marginLeft: 8, fontSize: 10 }}>this machine</span>
            ) : (
              <span className="chip chip--neutral" style={{ marginLeft: 8, fontSize: 10 }}>{snapshot.machineId.slice(0, 8)}</span>
            )}
          </div>
          <div className="muted mono small" style={{ marginTop: 2 }}>
            {snapshot.id} · {formatBytes(snapshot.sizeBytes)}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {snapshot.manifest.agentInventory.map((a) => (
              <span key={a.kind} className="chip" style={{ fontSize: 10 }}>
                {a.kind}: {Object.values(a.counts).reduce((s, n) => s + n, 0)}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn--ghost" onClick={() => setOpen(!open)} style={{ fontSize: 11 }}>
            {open ? 'Cancel' : 'Restore'}
          </button>
          <button
            className="btn btn--ghost"
            onClick={onDelete}
            style={{ fontSize: 11, color: 'var(--badge-red-fg)' }}
          >
            Delete
          </button>
        </div>
      </div>
      {open ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <input
            type="password"
            placeholder="passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            style={{ ...inputStyle, fontSize: 12 }}
          />
          <button
            className="btn btn--primary"
            disabled={pulling || pass.length < 8}
            onClick={() => onPull(pass)}
            style={{ fontSize: 12 }}
          >
            {pulling ? 'Decrypting…' : 'Decrypt + Stage'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ── shared style helpers ──────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-sub)',
        borderRadius: 'var(--radius-md)',
        padding: 20,
        marginBottom: 16,
      }}
    >
      {children}
    </section>
  )
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-sub)',
  background: 'var(--input-bg)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
}

// keep the type-only import alive for editors that strip unused imports.
export type { BackendHealth } from '../../../electron/preload'
