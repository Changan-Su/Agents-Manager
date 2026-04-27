import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { CodeDiff, inferLanguage } from '../components/CodeEditor'

export function DiffView() {
  const { assetId, backupPath } = useParams<{ assetId: string; backupPath: string }>()
  const [current, setCurrent] = useState<string>('')
  const [backup, setBackup] = useState<string>('')
  const [sourcePath, setSourcePath] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!assetId || !backupPath) return
    const decoded = decodeURIComponent(backupPath)
    const decodedAssetId = decodeURIComponent(assetId)
    Promise.all([
      window.api.asset.read(decodedAssetId),
      window.api.asset.readBackup(decodedAssetId, decoded),
    ])
      .then(([cur, bak]) => {
        setCurrent(cur.raw)
        setSourcePath(cur.parsed.sourcePath)
        setBackup(bak.raw)
      })
      .catch((e) => setError((e as Error).message))
  }, [assetId, backupPath])

  if (error) {
    return (
      <div>
        <div className="error-banner">{error}</div>
        <Link to="/dashboard" className="btn">Back</Link>
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 56px - 48px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 12 }}>
        <Link to="/dashboard" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Dashboard</Link>
        <h1 style={{ margin: '4px 0 0', fontSize: 18 }}>Diff vs backup</h1>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
          {sourcePath}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CodeDiff
          original={backup}
          modified={current}
          language={inferLanguage(sourcePath)}
          height="100%"
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
        Left: backup ({decodeURIComponent(backupPath ?? '')}) · Right: current file
      </div>
    </div>
  )
}
