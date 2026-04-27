import { Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from './Shell'
import { Dashboard } from '../pages/Dashboard'
import { AgentView } from '../pages/AgentView'
import { AssetDetail } from '../pages/AssetDetail'
import { SettingsPage } from '../pages/Settings'
import { DiffView } from '../pages/DiffView'
import { SyncPanel } from '../pages/SyncPanel'

export function Router() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/agent/:kind" element={<AgentView />} />
        <Route path="/agent/:kind/:assetKind" element={<AgentView />} />
        <Route path="/asset/:id" element={<AssetDetail />} />
        <Route path="/diff/:assetId/:backupPath" element={<DiffView />} />
        <Route path="/sync" element={<SyncPanel />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
