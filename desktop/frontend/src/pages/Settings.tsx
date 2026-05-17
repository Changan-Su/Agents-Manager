import { useEffect, useState } from 'react'

const EDIT_KEY = 'edit_enabled'

export function SettingsPage() {
  const [editEnabled, setEditEnabled] = useState<boolean | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    window.api.settings.get(EDIT_KEY).then((v) => setEditEnabled(v === 'true'))
  }, [])

  async function toggle() {
    if (editEnabled == null) return
    const next = !editEnabled
    await window.api.settings.set(EDIT_KEY, next ? 'true' : 'false')
    setEditEnabled(next)
    setSavedAt(Date.now())
  }

  if (editEnabled == null) return <div className="empty-state">Loading…</div>

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Settings</h1>

      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-sub)',
          borderRadius: 'var(--radius-md)',
          padding: 20,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>Enable editing</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
              When enabled, you can save changes back to your agent config files. Every save creates
              a <code>.bak.&lt;timestamp&gt;</code> next to the original and records a snapshot
              you can restore from. JSON and TOML files are syntax-validated before being written.
            </p>
            {editEnabled ? (
              <p style={{ color: 'var(--badge-red-fg)', fontSize: 12, marginTop: 8 }}>
                ⚠ Editing is currently <strong>ON</strong>. A bad write can break an agent until
                you restore from the backup. Be deliberate.
              </p>
            ) : null}
          </div>
          <button
            className={editEnabled ? 'btn btn--primary' : 'btn'}
            onClick={toggle}
            style={{ minWidth: 80 }}
          >
            {editEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-sub)',
          borderRadius: 'var(--radius-md)',
          padding: 20,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>About</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
          Agents Manager — Safe Alpha. Local-first control center for AI coding agents:
          multi-agent scan, asset edit-with-backup, diff, a local repository for skills /
          MCP servers / agents / commands / hooks (with deploy of those kinds), encrypted
          snapshot sync, live Claude session listing, and connected-backend status.
          OpenClaw support is currently an experimental stub (detection only); plugin and
          settings.json deploy via the repository, and remote repository sync, are not yet
          wired.
        </p>
      </section>

      {savedAt ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
          Saved.
        </div>
      ) : null}
    </div>
  )
}
