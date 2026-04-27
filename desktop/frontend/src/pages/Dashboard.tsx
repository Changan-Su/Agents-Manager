import { Link } from 'react-router-dom'
import { useScanStore } from '../stores/scanStore'
import type { AgentSummary } from '@shared/types'

const KIND_LABEL: Record<AgentSummary['kind'], string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
}

function formatRelative(ts: number | null): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`
  return new Date(ts).toLocaleString()
}

export function Dashboard() {
  const { agents, running, error, runScan, lastScanAt } = useScanStore()

  if (!agents.length && !running) {
    return (
      <div className="empty-state">
        <h2>Welcome to Agents Manager</h2>
        <p>Scan this machine to discover all your installed AI coding agents.</p>
        <button className="btn btn--primary" onClick={runScan} style={{ marginTop: 16 }}>
          Scan my machine
        </button>
        {error ? <div className="error-banner" style={{ marginTop: 24 }}>{error}</div> : null}
      </div>
    )
  }

  const detected = agents.filter((a) => a.present)
  const missing = agents.filter((a) => !a.present)

  return (
    <div>
      {error ? <div className="error-banner">{error}</div> : null}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Detected agents</h1>
          {lastScanAt ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              Last scan: {formatRelative(lastScanAt)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card-grid">
        {detected.map((a) => (
          <AgentCard key={a.kind} summary={a} />
        ))}
      </div>

      {missing.length > 0 && (
        <>
          <h3 className="section-title">Not detected</h3>
          <div className="card-grid">
            {missing.map((a) => (
              <div key={a.kind} className="agent-card agent-card--missing">
                <div className="agent-card__title">
                  {KIND_LABEL[a.kind]}
                  <span className="status-pill status-pill--missing">not installed</span>
                </div>
                <div className="agent-card__path">{a.root}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AgentCard({ summary }: { summary: AgentSummary }) {
  const c = summary.counts
  return (
    <Link to={`/agent/${summary.kind}`} className="agent-card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="agent-card__title">
        {KIND_LABEL[summary.kind]}
        <span className="status-pill">detected</span>
      </div>
      <div className="agent-card__path">{summary.root}</div>
      <div className="chip-row">
        {c.skills > 0 && <span className="chip">{c.skills} skills</span>}
        {c.agents > 0 && <span className="chip">{c.agents} agents</span>}
        {c.mcpServers > 0 && <span className="chip chip--green">{c.mcpServers} MCP</span>}
        {c.plugins > 0 && <span className="chip chip--neutral">{c.plugins} plugins</span>}
        {c.commands > 0 && <span className="chip chip--neutral">{c.commands} cmds</span>}
        {c.hooks > 0 && <span className="chip chip--neutral">{c.hooks} hooks</span>}
      </div>
      {summary.errors.length > 0 ? (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--badge-red-fg)' }}>
          {summary.errors.length} parse warning{summary.errors.length > 1 ? 's' : ''}
        </div>
      ) : null}
    </Link>
  )
}
