import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from '../components/Sidebar'
import { useScanStore } from '../stores/scanStore'
import { useSessionsStore } from '../stores/sessionsStore'

export function Shell() {
  const loadCached = useScanStore((s) => s.loadCached)
  const startSessions = useSessionsStore((s) => s.start)
  const stopSessions = useSessionsStore((s) => s.stop)

  useEffect(() => {
    loadCached()
    startSessions()
    return () => stopSessions()
  }, [loadCached, startSessions, stopSessions])

  return (
    <div className="app-shell app-shell--sidebar">
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
