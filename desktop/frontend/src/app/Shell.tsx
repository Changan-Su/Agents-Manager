import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { ModeToggle } from '../components/ModeToggle'
import { useScanStore } from '../stores/scanStore'

export function Shell() {
  const navigate = useNavigate()
  const { running, runScan, loadCached } = useScanStore()

  useEffect(() => {
    loadCached()
  }, [loadCached])

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/dashboard" className="app-header__brand" style={{ color: 'inherit' }}>
          <div className="logo" />
          <span>Agents Manager</span>
        </Link>
        <div className="app-header__actions">
          <button
            className="btn"
            onClick={async () => {
              await runScan()
              navigate('/dashboard')
            }}
            disabled={running}
          >
            {running ? <span className="spinner" /> : null}
            {running ? 'Scanning…' : 'Rescan'}
          </button>
          <ModeToggle />
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
