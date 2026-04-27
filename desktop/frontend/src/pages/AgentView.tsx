import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { Asset, McpServer, AgentSummary } from '@shared/types'
import { useScanStore } from '../stores/scanStore'

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
  useEffect(() => {
    window.api.asset.read(asset.id).then((r) => setRaw(r.raw))
  }, [asset.id])
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
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={() => window.api.fs.openInFinder(asset.sourcePath)}>
            Reveal
          </button>
          <button className="btn" onClick={() => window.api.fs.openPath(asset.sourcePath)}>
            Open
          </button>
        </div>
      </div>
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
      <div className="asset-detail__raw">{raw || 'Loading…'}</div>
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
