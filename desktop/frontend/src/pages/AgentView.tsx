import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Asset, McpServer, AgentSummary } from '@shared/types'
import { useScanStore } from '../stores/scanStore'
import { CodeEditor, inferLanguage } from '../components/CodeEditor'
import type { BackupRow } from '../api/types'

const TABS: Array<{ key: string; label: string; assetKind: Asset['kind'] | 'mcp' }> = [
  { key: 'skills', label: 'Skills', assetKind: 'skill' },
  { key: 'agents', label: 'Agents', assetKind: 'agent' },
  { key: 'mcp', label: 'MCP', assetKind: 'mcp' },
  { key: 'plugins', label: 'Plugins', assetKind: 'plugin' },
  { key: 'commands', label: 'Commands', assetKind: 'command' },
  { key: 'hooks', label: 'Hooks', assetKind: 'hook' },
  { key: 'settings', label: 'Settings', assetKind: 'settings' },
]

export function AgentView() {
  const { kind, assetKind } = useParams<{ kind: string; assetKind?: string }>()
  const navigate = useNavigate()
  const summaries = useScanStore((s) => s.agents)
  const summary = summaries.find((a) => a.kind === kind)

  const activeTabKey = assetKind ?? 'skills'
  const activeTab = TABS.find((t) => t.key === activeTabKey) ?? TABS[0]

  const [items, setItems] = useState<Asset[] | McpServer[]>([])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<Asset | McpServer | null>(null)

  useEffect(() => {
    if (!kind) return
    setSelected(null)
    setSelectedItem(null)
    if (activeTab.assetKind === 'mcp') {
      window.api.mcp.list(kind).then((mcps) => setItems(mcps))
    } else {
      window.api.asset.list(kind, activeTab.assetKind).then((assets) => setItems(assets))
    }
  }, [kind, activeTab.assetKind])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return (items as Array<Asset | McpServer>).filter((it) => {
      const name = it.name.toLowerCase()
      const desc = ('description' in it ? it.description ?? '' : '').toLowerCase()
      return name.includes(q) || desc.includes(q)
    }) as typeof items
  }, [items, filter])

  if (!summary || !kind) {
    return (
      <div className="empty-state">
        <h2>Agent not found</h2>
        <Link to="/dashboard" className="btn">Back to dashboard</Link>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Link to="/dashboard" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Dashboard</Link>
      </div>
      <h1 style={{ margin: 0, fontSize: 22 }}>{labelFor(summary)}</h1>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace', marginBottom: 12 }}>
        {summary.root}
      </div>

      <div className="tab-bar">
        {TABS.map((tab) => {
          const count = countFor(summary, tab.key)
          return (
            <div
              key={tab.key}
              className={`tab ${tab.key === activeTab.key ? 'tab--active' : ''}`}
              onClick={() => navigate(`/agent/${kind}/${tab.key}`)}
            >
              {tab.label}
              {count != null && <span className="tab__count">{count}</span>}
            </div>
          )
        })}
      </div>

      <div className="split-view">
        <div className="asset-list">
          <div className="asset-list__search">
            <input
              type="text"
              placeholder={`Filter ${activeTab.label.toLowerCase()}…`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
              {items.length === 0 ? 'Nothing to show.' : 'No matches.'}
            </div>
          ) : (
            (filtered as Array<Asset | McpServer>).map((it) => {
              const id = idFor(it)
              const isActive = id === selected
              return (
                <div
                  key={id}
                  className={`asset-row ${isActive ? 'asset-row--active' : ''}`}
                  onClick={() => {
                    setSelected(id)
                    setSelectedItem(it)
                  }}
                >
                  <div className="asset-row__name">{it.name}</div>
                  {('description' in it && it.description) ? (
                    <div className="asset-row__desc">{it.description}</div>
                  ) : 'sourcePath' in it ? (
                    <div className="asset-row__desc" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                      {it.sourcePath}
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        <div className="asset-detail">
          {selectedItem ? (
            'rawHash' in selectedItem ? (
              <AssetPreview asset={selectedItem} />
            ) : (
              <McpPreview server={selectedItem} />
            )
          ) : (
            <div className="empty-state" style={{ padding: 32 }}>
              <p>Select an item to inspect.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AssetPreview({ asset }: { asset: Asset }) {
  const [raw, setRaw] = useState<string>('')
  const [draft, setDraft] = useState<string>('')
  const [editEnabled, setEditEnabled] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backups, setBackups] = useState<BackupRow[]>([])
  const navigate = useNavigate()
  const lang = inferLanguage(asset.sourcePath)

  useEffect(() => {
    setError(null)
    setEditing(false)
    window.api.asset.read(asset.id).then((r) => {
      setRaw(r.raw)
      setDraft(r.raw)
    })
    window.api.asset.listBackups(asset.id).then(setBackups)
    window.api.settings.get('edit_enabled').then((v) => setEditEnabled(v === 'true'))
  }, [asset.id])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await window.api.asset.write(asset.id, draft)
      const fresh = await window.api.asset.read(asset.id)
      setRaw(fresh.raw)
      setDraft(fresh.raw)
      setEditing(false)
      const list = await window.api.asset.listBackups(asset.id)
      setBackups(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(raw)
    setEditing(false)
    setError(null)
  }

  return (
    <>
      <div className="asset-detail__header">
        <div>
          <div className="asset-detail__title">{asset.name}</div>
          {asset.description ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              {asset.description}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => window.api.fs.openInFinder(asset.sourcePath)}>
            Reveal
          </button>
          <button className="btn" onClick={() => window.api.fs.openPath(asset.sourcePath)}>
            Open
          </button>
          {!editing ? (
            <button
              className="btn btn--primary"
              disabled={!editEnabled}
              title={editEnabled ? 'Edit this file' : 'Enable editing in Settings first'}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          ) : (
            <>
              <button className="btn" onClick={cancel} disabled={saving}>Cancel</button>
              <button className="btn btn--primary" onClick={save} disabled={saving || draft === raw}>
                {saving ? 'Saving…' : 'Save + Backup'}
              </button>
            </>
          )}
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="asset-detail__meta-grid">
        <div>
          <div className="asset-detail__meta-label">Kind</div>
          <div>{asset.kind}</div>
        </div>
        {asset.model ? (
          <div>
            <div className="asset-detail__meta-label">Model</div>
            <div>{asset.model}</div>
          </div>
        ) : null}
        {asset.tools?.length ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="asset-detail__meta-label">Tools</div>
            <div className="chip-row">
              {asset.tools.map((t) => <span key={t} className="chip chip--neutral">{t}</span>)}
            </div>
          </div>
        ) : null}
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="asset-detail__meta-label">Source</div>
          <div className="asset-detail__source">{asset.sourcePath}</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 220, marginBottom: 8 }}>
        <CodeEditor
          value={editing ? draft : raw}
          language={lang}
          readOnly={!editing}
          onChange={editing ? setDraft : undefined}
          height="100%"
        />
      </div>

      {backups.length > 0 ? (
        <div style={{ marginTop: 6 }}>
          <div className="asset-detail__meta-label" style={{ marginBottom: 6 }}>
            Backups ({backups.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 130, overflowY: 'auto' }}>
            {backups.map((b) => (
              <div
                key={b.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  padding: '6px 10px',
                  background: 'var(--surface-hover)',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>
                  {new Date(b.editedAt).toLocaleString()}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn--ghost"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() =>
                      navigate(`/diff/${encodeURIComponent(asset.id)}/${encodeURIComponent(b.backupPath)}`)
                    }
                  >
                    Diff
                  </button>
                  <button
                    className="btn btn--ghost"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    disabled={!editEnabled}
                    onClick={async () => {
                      if (!confirm(`Revert ${asset.name} to this backup?`)) return
                      try {
                        await window.api.asset.revert(asset.id, b.backupPath)
                        const fresh = await window.api.asset.read(asset.id)
                        setRaw(fresh.raw)
                        setDraft(fresh.raw)
                        setBackups(await window.api.asset.listBackups(asset.id))
                      } catch (e) {
                        setError((e as Error).message)
                      }
                    }}
                  >
                    Revert
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

function McpPreview({ server }: { server: McpServer }) {
  return (
    <>
      <div className="asset-detail__header">
        <div>
          <div className="asset-detail__title">{server.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            MCP Server · {server.type ?? 'stdio'}
          </div>
        </div>
        <button className="btn" onClick={() => window.api.fs.openInFinder(server.sourcePath)}>
          Reveal config
        </button>
      </div>
      <div className="asset-detail__meta-grid">
        {server.command ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="asset-detail__meta-label">Command</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {server.command} {server.args?.join(' ')}
            </div>
          </div>
        ) : null}
        {server.url ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="asset-detail__meta-label">URL</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{server.url}</div>
          </div>
        ) : null}
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="asset-detail__meta-label">Source</div>
          <div className="asset-detail__source">{server.sourcePath}</div>
        </div>
      </div>
      <div className="asset-detail__raw">{JSON.stringify(server, null, 2)}</div>
    </>
  )
}

function labelFor(s: AgentSummary): string {
  return {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    opencode: 'OpenCode',
    openclaw: 'OpenClaw',
  }[s.kind]
}

function countFor(s: AgentSummary, key: string): number | null {
  const map: Record<string, keyof AgentSummary['counts'] | 'settings'> = {
    skills: 'skills',
    agents: 'agents',
    plugins: 'plugins',
    commands: 'commands',
    hooks: 'hooks',
    mcp: 'mcpServers',
    settings: 'settings',
  }
  const k = map[key]
  if (!k) return null
  if (k === 'settings') return null
  return s.counts[k]
}

function idFor(it: Asset | McpServer): string {
  if ('rawHash' in it) return it.id
  return `mcp:${it.agentKind}:${it.name}`
}
