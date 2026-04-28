import { Link } from 'react-router-dom'
import { useScanStore } from '../stores/scanStore'
import { useSessionsStore } from '../stores/sessionsStore'
import { StatusDot } from '../components/StatusDot'
import type { AgentSummary, ClaudeSession } from '@shared/types'

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
  const { claude, processes } = useSessionsStore()
  const liveClaude = claude.filter((c) => c.alive)

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
    <div className="page-grid">
      {error ? <div className="error-banner">{error}</div> : null}

      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="page-header__sub">
            {detected.length} detected agent{detected.length === 1 ? '' : 's'}
            {lastScanAt ? <> · last scan {formatRelative(lastScanAt)}</> : null}
          </div>
        </div>
      </header>

      {/* Active sessions strip */}
      <section className="dashboard-strip">
        <div className="dashboard-strip__head">
          <div>
            <div className="dashboard-strip__title">Active sessions</div>
            <div className="page-header__sub">
              {liveClaude.length} Claude Code · {processes.length} other agent
              {processes.length === 1 ? '' : 's'}
            </div>
          </div>
          <Link to="/sessions" className="btn btn--ghost" style={{ fontSize: 12 }}>
            View all →
          </Link>
        </div>
        {liveClaude.length === 0 && processes.length === 0 ? (
          <div className="muted small" style={{ marginTop: 8 }}>
            Nothing running right now.
          </div>
        ) : (
          <div className="session-strip">
            {liveClaude.slice(0, 5).map((s) => (
              <ActiveSessionPill key={s.sessionId} session={s} />
            ))}
            {processes.slice(0, 4).map((p) => (
              <div key={p.pid} className="session-pill">
                <StatusDot kind="busy" />
                <span style={{ fontWeight: 500 }}>{p.agentKind}</span>
                <span className="muted small">PID {p.pid}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="card-grid">
        {detected.map((a) => {
          const live = liveClaude.filter((c) => agentKindFromCwd(c.cwd) === a.kind).length
          return <AgentCard key={a.kind} summary={a} liveSessions={live} />
        })}
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

function ActiveSessionPill({ session }: { session: ClaudeSession }) {
  const status = session.status === 'busy' ? 'busy' : session.status === 'waiting' ? 'idle' : 'idle'
  return (
    <Link to="/sessions" className="session-pill" style={{ textDecoration: 'none' }}>
      <StatusDot kind={status} />
      <span style={{ fontWeight: 500 }}>{session.name ?? session.sessionId.slice(0, 8)}</span>
      <span className="muted small">PID {session.pid}</span>
      {session.cwd ? (
        <span className="muted small mono" title={session.cwd}>
          {short(session.cwd)}
        </span>
      ) : null}
    </Link>
  )
}

function AgentCard({ summary, liveSessions }: { summary: AgentSummary; liveSessions: number }) {
  const c = summary.counts
  return (
    <Link
      to={`/agent/${summary.kind}`}
      className="agent-card"
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div className="agent-card__title">
        {KIND_LABEL[summary.kind]}
        {liveSessions > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <StatusDot kind="busy" />
            <span className="status-pill" style={{ fontSize: 10 }}>{liveSessions} live</span>
          </span>
        ) : (
          <span className="status-pill">detected</span>
        )}
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

function agentKindFromCwd(_cwd: string): AgentSummary['kind'] {
  // We can't (easily) tell which agent kind a Claude session belongs to from
  // its cwd alone — Claude Code is the only one we currently surface in
  // ClaudeSessionWatcher, so attribute everything to claude-code.
  return 'claude-code'
}

function short(p: string): string {
  const home = '/home/'
  if (p.length > 36) return '…' + p.slice(-34)
  if (p.startsWith(home)) return '~/' + p.split('/').slice(3).join('/')
  return p
}
