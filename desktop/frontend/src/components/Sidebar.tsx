import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useScanStore } from '../stores/scanStore'
import { useSessionsStore } from '../stores/sessionsStore'
import { ModeToggle } from './ModeToggle'
import { StatusDot } from './StatusDot'

interface SidebarItem {
  to: string
  label: string
  icon: React.ReactNode
  badge?: string | number | null
}

export function Sidebar() {
  const running = useScanStore((s) => s.running)
  const runScan = useScanStore((s) => s.runScan)
  const agents = useScanStore((s) => s.agents)
  // Each selector returns a primitive so Zustand can use Object.is and skip
  // re-renders when nothing actually changed. Returning a fresh object each
  // call would loop forever (React 18 useSyncExternalStore guard).
  const claudeSessions = useSessionsStore((s) => s.claude)
  const processCount = useSessionsStore((s) => s.processes.length)
  const activeBusy = claudeSessions.filter((c) => c.alive && c.status === 'busy').length
  const claudeCount = claudeSessions.filter((c) => c.alive).length
  const [connection, setConnection] = useState<'unknown' | 'ok' | 'error' | 'offline'>('unknown')
  const [backendLabel, setBackendLabel] = useState<string>('Not connected')

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const s = await window.api.sync.status()
        if (cancelled) return
        if (!s.backendUrl) {
          setConnection('offline')
          setBackendLabel('Not connected')
        } else if (s.connected) {
          setConnection('ok')
          setBackendLabel(s.backendUrl.replace(/^https?:\/\//, ''))
        } else {
          setConnection('error')
          setBackendLabel(s.backendUrl.replace(/^https?:\/\//, ''))
        }
      } catch {
        if (!cancelled) setConnection('error')
      }
    }
    void refresh()
    const t = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  const detected = agents.filter((a) => a.present).length
  const liveSessions = claudeCount + processCount

  const items: SidebarItem[] = [
    {
      to: '/dashboard',
      label: 'Dashboard',
      icon: <DashboardIcon />,
      badge: detected || null,
    },
    {
      to: '/sessions',
      label: 'Sessions',
      icon: <SessionsIcon />,
      badge: liveSessions || null,
    },
    {
      to: '/repository',
      label: 'Repository',
      icon: <RepoIcon />,
    },
    {
      to: '/sync',
      label: 'Sync',
      icon: <SyncIcon />,
    },
    {
      to: '/settings',
      label: 'Settings',
      icon: <SettingsIcon />,
    },
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="logo" />
        <div>
          <div className="sidebar__title">Agents</div>
          <div className="sidebar__subtitle">Manager</div>
        </div>
      </div>

      <button
        className="btn btn--primary sidebar__rescan"
        onClick={() => void runScan()}
        disabled={running}
      >
        {running ? <span className="spinner" /> : null}
        {running ? 'Scanning…' : 'Rescan'}
      </button>

      <nav className="sidebar__nav">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `sidebar__item ${isActive ? 'sidebar__item--active' : ''}`
            }
          >
            <span className="sidebar__icon">{it.icon}</span>
            <span className="sidebar__label">{it.label}</span>
            {it.badge != null ? (
              <span className="sidebar__badge">
                {typeof it.badge === 'number' && activeBusy > 0 && it.to === '/sessions' ? (
                  <>
                    <span className="dot dot--busy" /> {it.badge}
                  </>
                ) : (
                  it.badge
                )}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__connection" title={backendLabel}>
          <StatusDot
            kind={
              connection === 'ok'
                ? 'ok'
                : connection === 'error'
                  ? 'error'
                  : 'idle'
            }
          />
          <span className="sidebar__connection-label">{backendLabel}</span>
        </div>
        <ModeToggle />
      </div>
    </aside>
  )
}

// ── icons (inline to avoid pulling a library) ─────────────────────────────

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function SessionsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6,4 20,12 6,20" />
    </svg>
  )
}

function RepoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M16 5v5h5" />
    </svg>
  )
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3.5-7.1L21 8" />
      <polyline points="21 3 21 8 16 8" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a7.5 7.5 0 0 0 0-6l2.1-1.6-2-3.4-2.5 1A7.5 7.5 0 0 0 12 3l-.5-2.6h-3L8 3a7.5 7.5 0 0 0-4.9 2L0.6 4l-2 3.4L0.6 9a7.5 7.5 0 0 0 0 6l-2.1 1.6 2 3.4 2.5-1A7.5 7.5 0 0 0 8 21l.5 2.6h3L12 21a7.5 7.5 0 0 0 4.9-2l2.5 1 2-3.4z" />
    </svg>
  )
}
