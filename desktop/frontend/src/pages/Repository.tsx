import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useRepositoryStore } from '../stores/repositoryStore'
import { useScanStore } from '../stores/scanStore'
import { CodeEditor, inferLanguage } from '../components/CodeEditor'
import { DeployDialog } from '../components/DeployDialog'
import type { Asset, RepositoryItem, RepositoryKind } from '@shared/types'

const KIND_TABS: Array<{ key: RepositoryKind | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'skill', label: 'Skills' },
  { key: 'mcp_server', label: 'MCP servers' },
  { key: 'command', label: 'Commands' },
  { key: 'hook', label: 'Hooks' },
  { key: 'agent_def', label: 'Agents' },
]

export function Repository() {
  const { items, loading, error, refresh, remove } = useRepositoryStore()
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeKind, setActiveKind] = useState<RepositoryKind | 'all'>('all')
  const [filter, setFilter] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [deploying, setDeploying] = useState<RepositoryItem | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return items.filter((it) => {
      if (activeKind !== 'all' && it.kind !== activeKind) return false
      if (!q) return true
      return (
        it.name.toLowerCase().includes(q) ||
        (it.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, filter, activeKind])

  const selected = items.find((it) => it.id === params.id) ?? null

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <h1>Repository</h1>
          <div className="page-header__sub">
            {items.length} item{items.length === 1 ? '' : 's'} · stored locally, deploy to any installed agent
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={() => setShowImport(true)}>
            Import from Agent
          </button>
          <button className="btn btn--primary" onClick={() => void newSkill(refresh, navigate)}>
            + New skill
          </button>
        </div>
      </header>

      <div className="tab-bar">
        {KIND_TABS.map((t) => (
          <div
            key={t.key}
            className={`tab ${activeKind === t.key ? 'tab--active' : ''}`}
            onClick={() => setActiveKind(t.key)}
          >
            {t.label}
            <span className="tab__count">
              {t.key === 'all' ? items.length : items.filter((i) => i.kind === t.key).length}
            </span>
          </div>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="split-view">
        <div className="asset-list">
          <div className="asset-list__search">
            <input
              type="text"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {loading && filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}>
              <p>Nothing here yet. Import from a detected agent or create a new item.</p>
            </div>
          ) : (
            filtered.map((it) => (
              <div
                key={it.id}
                className={`asset-row ${selected?.id === it.id ? 'asset-row--active' : ''}`}
                onClick={() => navigate(`/repository/${it.id}`)}
              >
                <div className="asset-row__name">
                  {it.name}
                  {it.deployedTo.length > 0 ? (
                    <span className="chip chip--green" style={{ marginLeft: 6, fontSize: 10 }}>
                      deployed ×{it.deployedTo.length}
                    </span>
                  ) : null}
                </div>
                <div className="asset-row__desc">
                  {it.description ?? `${it.kind}${it.version ? ` · ${it.version}` : ''}`}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="asset-detail">
          {!selected ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <p>Select a repository item to inspect, edit, or deploy.</p>
            </div>
          ) : (
            <RepositoryDetail
              item={selected}
              onDeploy={() => setDeploying(selected)}
              onDelete={async () => {
                if (!confirm(`Delete "${selected.name}"? Storage on disk will be removed.`)) return
                await remove(selected.id)
                navigate('/repository')
              }}
            />
          )}
        </div>
      </div>

      {showImport ? (
        <ImportDialog onClose={() => setShowImport(false)} onImported={() => refresh()} />
      ) : null}

      {deploying ? (
        <DeployDialog
          item={deploying}
          onClose={() => setDeploying(null)}
          onDeployed={() => refresh()}
        />
      ) : null}
    </div>
  )
}

// ── Detail ────────────────────────────────────────────────────────────────

function RepositoryDetail({
  item,
  onDeploy,
  onDelete,
}: {
  item: RepositoryItem
  onDeploy: () => void
  onDelete: () => void
}) {
  const [files, setFiles] = useState<Array<{ relPath: string; content: string }>>([])
  const [activeRel, setActiveRel] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setEditing(false)
    setErr(null)
    void window.api.repository.read(item.id).then((r) => {
      setFiles(r.files)
      const primary = r.item.manifest.primaryFile
      const target = primary ?? r.files[0]?.relPath ?? null
      setActiveRel(target)
      const content = r.files.find((f) => f.relPath === target)?.content ?? ''
      setDraft(content)
    })
  }, [item.id])

  const active = files.find((f) => f.relPath === activeRel)

  async function save() {
    if (!active) return
    setSaving(true)
    setErr(null)
    try {
      const next = files.map((f) => (f.relPath === active.relPath ? { ...f, content: draft } : f))
      await window.api.repository.update({ id: item.id, files: next })
      setFiles(next)
      setEditing(false)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="asset-detail__header">
        <div>
          <div className="asset-detail__title">{item.name}</div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {item.kind}
            {item.version ? ` · ${item.version}` : ''}
            {' · '}
            <span className="mono">{item.storagePath}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => window.api.fs.openInFinder(item.storagePath)}>
            Reveal
          </button>
          <button className="btn btn--primary" onClick={onDeploy}>
            Deploy
          </button>
          <button className="btn" onClick={onDelete} style={{ color: 'var(--badge-red-fg)' }}>
            Delete
          </button>
        </div>
      </div>

      {err ? <div className="error-banner">{err}</div> : null}

      <div className="asset-detail__meta-grid">
        <div>
          <div className="asset-detail__meta-label">Files</div>
          <div>{item.manifest.files.length}</div>
        </div>
        <div>
          <div className="asset-detail__meta-label">Deployments</div>
          <div>{item.deployedTo.length}</div>
        </div>
      </div>

      {item.deployedTo.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <div className="section-title">Deployed to</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {item.deployedTo.map((d) => (
              <div
                key={d.deploymentId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 10px',
                  background: 'var(--surface-hover)',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: 12,
                }}
              >
                <span>
                  <span className="chip chip--green" style={{ fontSize: 10 }}>
                    {d.agentKind}
                  </span>{' '}
                  <span className="muted">{d.scope}</span>{' '}
                  <span className="mono">{d.targetPath}</span>
                </span>
                <button
                  className="btn btn--ghost"
                  style={{ fontSize: 11 }}
                  onClick={async () => {
                    await window.api.repository.undeploy(item.id, d.deploymentId)
                  }}
                >
                  Forget
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="section-title">Files</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {files.map((f) => (
          <button
            key={f.relPath}
            className={f.relPath === activeRel ? 'btn btn--primary' : 'btn'}
            style={{ fontSize: 11 }}
            onClick={() => {
              setActiveRel(f.relPath)
              setDraft(f.content)
              setEditing(false)
            }}
          >
            {f.relPath}
          </button>
        ))}
      </div>
      {active ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
            {editing ? (
              <>
                <button className="btn" onClick={() => { setEditing(false); setDraft(active.content) }} disabled={saving}>
                  Cancel
                </button>
                <button
                  className="btn btn--primary"
                  onClick={() => void save()}
                  disabled={saving || draft === active.content}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button className="btn btn--primary" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 280 }}>
            <CodeEditor
              value={editing ? draft : active.content}
              language={inferLanguage(active.relPath)}
              readOnly={!editing}
              onChange={editing ? setDraft : undefined}
              height="100%"
            />
          </div>
        </>
      ) : (
        <div className="empty-state" style={{ padding: 24 }}>
          <p>No files in this item.</p>
        </div>
      )}
    </>
  )
}

// ── Import dialog ─────────────────────────────────────────────────────────

function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const agents = useScanStore((s) => s.agents).filter((a) => a.present)
  const [agentKind, setAgentKind] = useState<string>(agents[0]?.kind ?? '')
  const [kind, setKind] = useState<'skill' | 'command' | 'hook' | 'agent' | 'mcp'>('skill')
  const [items, setItems] = useState<Array<Asset | { name: string; sourcePath: string }>>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!agentKind) return
    setErr(null)
    setItems([])
    if (kind === 'mcp') {
      void window.api.mcp.list(agentKind).then((mcps) => setItems(mcps.map((m) => ({ name: m.name, sourcePath: m.sourcePath }))))
    } else {
      void window.api.asset.list(agentKind, kind).then(setItems)
    }
  }, [agentKind, kind])

  async function importOne(it: Asset | { name: string; sourcePath: string }) {
    setBusy(true)
    setErr(null)
    try {
      if (kind === 'mcp') {
        await window.api.repository.importMcp(agentKind as 'claude-code', it.name)
      } else {
        await window.api.repository.importFromAsset((it as Asset).id)
      }
      onImported()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2 style={{ margin: 0, fontSize: 16 }}>Import from Agent</h2>
          <button className="btn btn--ghost" onClick={onClose}>×</button>
        </header>

        <section className="modal__body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select value={agentKind} onChange={(e) => setAgentKind(e.target.value)}>
              {agents.map((a) => (
                <option key={a.kind} value={a.kind}>
                  {a.kind}
                </option>
              ))}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as 'skill')}>
              <option value="skill">skills</option>
              <option value="command">commands</option>
              <option value="hook">hooks</option>
              <option value="agent">agents</option>
              <option value="mcp">mcp</option>
            </select>
          </div>

          {err ? <div className="error-banner">{err}</div> : null}

          {items.length === 0 ? (
            <div className="muted">No items of that kind on this agent.</div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((it) => (
                <div
                  key={'id' in it ? it.id : it.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    background: 'var(--surface-hover)',
                    borderRadius: 'var(--radius-xs)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{it.name}</div>
                    <div className="muted small mono">{it.sourcePath}</div>
                  </div>
                  <button
                    className="btn btn--primary"
                    style={{ fontSize: 11 }}
                    onClick={() => void importOne(it)}
                    disabled={busy}
                  >
                    Import
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="modal__footer">
          <button className="btn" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  )
}

async function newSkill(refresh: () => Promise<void>, navigate: (path: string) => void) {
  const name = prompt('Skill name (becomes the folder under skills/):')
  if (!name) return
  const safe = name.trim().replace(/[^a-zA-Z0-9_.-]/g, '-')
  if (!safe) return
  const created = await window.api.repository.create({
    kind: 'skill',
    name: safe,
    files: [
      {
        relPath: 'SKILL.md',
        content: `---\nname: ${safe}\ndescription: TODO — describe when to use this skill.\n---\n\n# ${safe}\n\nReplace this body with your skill instructions.\n`,
      },
    ],
    primaryFile: 'SKILL.md',
  })
  await refresh()
  navigate(`/repository/${created.id}`)
}
