import { useEffect, useState } from 'react'

interface SyncStatus {
  configured: boolean
  signedIn: boolean
  backendUrl?: string
  user?: { id: string; email: string; role: string }
  machineId?: string
  machineLabel?: string
  error?: string
}

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
  const [restorePreview, setRestorePreview] = useState<{
    snapshotId: string
    stagingDir: string
    files: Array<{ archiveRel: string; absPath: string; selected: boolean }>
  } | null>(null)

  useEffect(() => {
    refreshStatus()
  }, [])

  async function refreshStatus() {
    const s = await window.api.sync.status()
    setStatus(s)
    if (s.signedIn) {
      try {
        const list = await window.api.sync.list()
        setSnapshots(list)
      } catch (e) {
        setError((e as Error).message)
      }
    } else {
      setSnapshots([])
    }
  }

  async function configure(backendUrl: string) {
    setError(null)
    try {
      await window.api.sync.configure(backendUrl)
      setInfo(`Connected to ${backendUrl}`)
      await refreshStatus()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function signIn(email: string, password: string, register: boolean) {
    setError(null)
    try {
      if (register) await window.api.sync.register(email, password)
      else await window.api.sync.login(email, password)
      await refreshStatus()
      setInfo('Signed in.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function logout() {
    await window.api.sync.logout()
    await refreshStatus()
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
      // Walk the staging dir on main side later; for now, ask user to confirm
      // a blanket apply. We expose the staging path so power users can inspect.
      setRestorePreview({
        snapshotId: snap.id,
        stagingDir,
        files: [],
      })
      setInfo(
        `Snapshot decrypted to ${stagingDir}. Use "Apply" to overwrite local files (each gets a .bak.*.pre-restore backup), or copy files manually from that path.`,
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
    <div style={{ maxWidth: 920 }}>
      <h1 style={{ marginTop: 0 }}>Sync</h1>

      {error ? <div className="error-banner">{error}</div> : null}
      {info ? <div className="error-banner" style={{ background: 'var(--badge-b-bg)', color: 'var(--badge-b-fg)' }}>{info}</div> : null}

      {!status.configured ? (
        <ConfigureBackend onSubmit={configure} />
      ) : !status.signedIn ? (
        <SignInForm
          backendUrl={status.backendUrl ?? ''}
          onSubmit={signIn}
          onChangeBackend={() => configure('')}
        />
      ) : (
        <SignedIn
          status={status}
          snapshots={snapshots}
          pushing={pushing}
          pulling={pulling}
          onPush={push}
          onPull={pull}
          onLogout={logout}
          onDelete={deleteSnap}
        />
      )}

      {pushResult ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border-sub)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14 }}>✓ Pushed</h3>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            Snapshot <code>{pushResult.snapshotId}</code> · {pushResult.fileCount} files ·{' '}
            {formatBytes(pushResult.sizeBytes)} encrypted
          </div>
        </section>
      ) : null}

      {restorePreview ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border-sub)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14 }}>Snapshot decrypted</h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 6 }}>
            {restorePreview.stagingDir}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>
            Apply (full restore) is intentionally manual in v1: open the staging dir in your file
            manager and copy what you need into the right agent root. The staging dir is
            organised as <code>&lt;agent-kind&gt;/&lt;original-relative-path&gt;</code>.
          </p>
          <button
            className="btn"
            onClick={() => window.api.fs.openPath(restorePreview.stagingDir)}
          >
            Open staging dir
          </button>
        </section>
      ) : null}
    </div>
  )
}

// ── ConfigureBackend ────────────────────────────────────────────────────

function ConfigureBackend({ onSubmit }: { onSubmit: (url: string) => void | Promise<void> }) {
  const [url, setUrl] = useState('http://localhost:8787')
  return (
    <Card>
      <h3 style={{ margin: 0, fontSize: 15 }}>Connect to a backend</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
        Point this app at a self-hosted Agents Manager backend. The server only stores encrypted
        blobs — your passphrase never leaves this machine.
      </p>
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <input
          className="input-bare"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-backend.example"
          style={inputStyle}
        />
        <button className="btn btn--primary" onClick={() => onSubmit(url.trim())}>
          Connect
        </button>
      </div>
    </Card>
  )
}

// ── SignInForm ──────────────────────────────────────────────────────────

function SignInForm({
  backendUrl,
  onSubmit,
  onChangeBackend,
}: {
  backendUrl: string
  onSubmit: (email: string, password: string, register: boolean) => void
  onChangeBackend: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  return (
    <Card>
      <h3 style={{ margin: 0, fontSize: 15 }}>
        {mode === 'login' ? 'Sign in' : 'Register'}
      </h3>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
        {backendUrl}{' '}
        <button className="btn btn--ghost" style={{ fontSize: 11, padding: '0 4px' }} onClick={onChangeBackend}>
          change
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn--primary" onClick={() => onSubmit(email, password, mode === 'register')}>
            {mode === 'login' ? 'Sign in' : 'Register'}
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Need an account?' : 'Have an account?'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          The first registration on a fresh backend becomes admin. Further registrations require{' '}
          <code>ALLOW_REGISTRATION=true</code> on the server.
        </p>
      </div>
    </Card>
  )
}

// ── SignedIn ────────────────────────────────────────────────────────────

function SignedIn({
  status,
  snapshots,
  pushing,
  pulling,
  onPush,
  onPull,
  onLogout,
  onDelete,
}: {
  status: SyncStatus
  snapshots: SyncSnapshot[]
  pushing: boolean
  pulling: boolean
  onPush: (pass: string) => void
  onPull: (snap: SyncSnapshot, pass: string) => void
  onLogout: () => void
  onDelete: (snap: SyncSnapshot) => void
}) {
  const [passphrase, setPassphrase] = useState('')
  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>Signed in as {status.user?.email}</h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
              {status.backendUrl} · machine: {status.machineLabel} ({status.machineId?.slice(0, 8)}…)
            </div>
          </div>
          <button className="btn" onClick={onLogout}>Sign out</button>
        </div>
      </Card>

      <Card>
        <h3 style={{ margin: 0, fontSize: 15 }}>Push snapshot</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
          Packs your detected agent configs (Claude Code · Codex · OpenCode · OpenClaw) into a
          tarball, encrypts it with AES-256-GCM using a key derived from the passphrase below, and
          uploads to the backend.{' '}
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
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
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
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
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
          <button className="btn btn--ghost" onClick={onDelete} style={{ fontSize: 11, color: 'var(--badge-red-fg)' }}>
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

// ── shared style helpers ───────────────────────────────────────────────

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
