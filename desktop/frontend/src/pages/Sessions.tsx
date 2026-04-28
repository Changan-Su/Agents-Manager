import { useEffect, useMemo, useState } from 'react'
import { useSessionsStore } from '../stores/sessionsStore'
import { StatusDot } from '../components/StatusDot'
import type { ClaudeSession, SessionEvent } from '@shared/types'

const KIND_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  unknown: 'Unknown',
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  const h = Math.floor(s / 3600)
  return `${h}h ${Math.floor((s % 3600) / 60)}m`
}

export function Sessions() {
  const { claude, processes, generatedAt, refresh } = useSessionsStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionEvent[] | null>(null)
  const [tailing, setTailing] = useState(false)
  const [tailError, setTailError] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const grouped = useMemo(() => {
    const live = claude.filter((s) => s.alive)
    const dead = claude.filter((s) => !s.alive)
    return { live, dead }
  }, [claude])

  const selected = claude.find((s) => s.sessionId === selectedId) ?? null

  useEffect(() => {
    if (!selected) {
      setEvents(null)
      return
    }
    let cancelled = false
    setTailing(true)
    setTailError(null)
    window.api.sessions
      .tail(selected.sessionId, 80)
      .then((res) => {
        if (cancelled) return
        setEvents(res.events)
      })
      .catch((e) => {
        if (cancelled) return
        setTailError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setTailing(false)
      })

    // Re-tail when the session updates (busy → idle transitions, etc.)
    const id = setInterval(() => void refresh(), 5_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [selectedId, refresh, selected?.updatedAt])

  return (
    <div className="page-grid">
      <header className="page-header">
        <div>
          <h1>Sessions</h1>
          <div className="page-header__sub">
            {grouped.live.length} live · {grouped.dead.length} ended ·{' '}
            {processes.length} other CLI agents
            {generatedAt ? <span> · updated {new Date(generatedAt).toLocaleTimeString()}</span> : null}
          </div>
        </div>
        <button className="btn" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      <div className="sessions-layout">
        <div className="sessions-list">
          <SectionHeader label="Active Claude Code sessions" count={grouped.live.length} />
          {grouped.live.length === 0 ? (
            <Empty text="No live Claude Code sessions." />
          ) : (
            grouped.live.map((s) => (
              <SessionRow
                key={s.sessionId}
                session={s}
                active={s.sessionId === selectedId}
                onSelect={() => setSelectedId(s.sessionId)}
              />
            ))
          )}

          {processes.length > 0 ? (
            <>
              <SectionHeader label="Other agent processes" count={processes.length} />
              {processes.map((p) => (
                <div key={p.pid} className="process-row">
                  <div className="process-row__head">
                    <StatusDot kind="busy" />
                    <strong>{KIND_LABEL[p.agentKind] ?? p.agentKind}</strong>
                    <span className="muted">PID {p.pid}</span>
                  </div>
                  {p.cwd ? (
                    <div className="muted mono small">{p.cwd}</div>
                  ) : null}
                  <div className="muted small">since {p.startedAt ? new Date(p.startedAt).toLocaleString() : 'unknown'}</div>
                </div>
              ))}
            </>
          ) : null}

          {grouped.dead.length > 0 ? (
            <>
              <SectionHeader label="Recently ended" count={grouped.dead.length} />
              {grouped.dead.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  active={s.sessionId === selectedId}
                  onSelect={() => setSelectedId(s.sessionId)}
                />
              ))}
            </>
          ) : null}
        </div>

        <div className="sessions-detail">
          {!selected ? (
            <Empty text="Select a session to inspect its recent activity." />
          ) : (
            <SessionDetail session={selected} events={events} tailing={tailing} tailError={tailError} />
          )}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="section-title" style={{ margin: '12px 0 6px' }}>
      {label} ({count})
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state" style={{ padding: 24 }}>
      <p>{text}</p>
    </div>
  )
}

function SessionRow({
  session,
  active,
  onSelect,
}: {
  session: ClaudeSession
  active: boolean
  onSelect: () => void
}) {
  const status = session.alive
    ? session.status === 'busy'
      ? 'busy'
      : 'idle'
    : 'dead'
  return (
    <div
      className={`session-row ${active ? 'session-row--active' : ''}`}
      onClick={onSelect}
    >
      <div className="session-row__head">
        <StatusDot kind={status} />
        <strong>{session.name ?? 'session'}</strong>
        <span className="muted small">PID {session.pid}</span>
        {session.hasIdeBinding ? <span className="chip chip--neutral">IDE</span> : null}
      </div>
      <div className="muted mono small">{shortenCwd(session.cwd)}</div>
      <div className="muted small">
        {session.alive
          ? `${formatDuration(Date.now() - session.startedAt)} · ${session.status}`
          : `ended · ${session.sessionId.slice(0, 8)}`}
      </div>
      {session.recentEventTypes?.length ? (
        <div className="chip-row" style={{ marginTop: 6 }}>
          {session.recentEventTypes.slice(-3).map((t, i) => (
            <span key={i} className="chip chip--neutral" style={{ fontSize: 10 }}>
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SessionDetail({
  session,
  events,
  tailing,
  tailError,
}: {
  session: ClaudeSession
  events: SessionEvent[] | null
  tailing: boolean
  tailError: string | null
}) {
  return (
    <div>
      <div className="session-detail__head">
        <div>
          <h2 style={{ margin: 0 }}>{session.name ?? session.sessionId.slice(0, 8)}</h2>
          <div className="muted mono small" style={{ marginTop: 4 }}>
            session {session.sessionId}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn"
            onClick={() => session.cwd && window.api.fs.openInFinder(session.cwd)}
            disabled={!session.cwd}
          >
            Reveal cwd
          </button>
        </div>
      </div>

      <div className="meta-grid">
        <Meta label="PID" value={String(session.pid)} />
        <Meta label="Status" value={session.alive ? session.status : 'dead'} />
        <Meta label="Started" value={new Date(session.startedAt).toLocaleString()} />
        <Meta label="Updated" value={new Date(session.updatedAt).toLocaleString()} />
        <Meta label="cwd" value={session.cwd || '—'} mono full />
      </div>

      <div className="section-title">Recent events</div>
      {tailError ? <div className="error-banner">{tailError}</div> : null}
      {tailing && !events ? (
        <div className="muted">Loading…</div>
      ) : events && events.length ? (
        <div className="event-log">
          {events.map((e, i) => (
            <div key={i} className="event-row">
              <span className="muted small mono">
                {e.ts ? new Date(e.ts).toLocaleTimeString() : ''}
              </span>
              <span className="chip chip--neutral" style={{ fontSize: 10 }}>{e.type}</span>
              <span className="event-row__preview mono small">{e.preview || '—'}</span>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="No events found yet. Sessions log to ~/.claude/projects/<slug>/." />
      )}
    </div>
  )
}

function Meta({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined }}>
      <div className="asset-detail__meta-label">{label}</div>
      <div style={{ fontFamily: mono ? 'monospace' : undefined, fontSize: mono ? 12 : undefined, wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  )
}

function shortenCwd(cwd: string): string {
  if (!cwd) return '—'
  if (cwd.length <= 60) return cwd
  return '…' + cwd.slice(-58)
}
