import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { Asset } from '@shared/types'

export function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [raw, setRaw] = useState('')

  useEffect(() => {
    if (!id) return
    window.api.asset.read(id).then((r) => {
      setAsset(r.parsed)
      setRaw(r.raw)
    })
  }, [id])

  if (!asset) return <div className="empty-state">Loading…</div>

  return (
    <div>
      <Link to={`/agent/${asset.agentKind}/${asset.kind}s`} style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        ← Back to {asset.agentKind}
      </Link>
      <div className="asset-detail" style={{ marginTop: 12 }}>
        <div className="asset-detail__header">
          <div>
            <div className="asset-detail__title">{asset.name}</div>
            {asset.description ? (
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{asset.description}</div>
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
        <div className="asset-detail__source">{asset.sourcePath}</div>
        <div className="asset-detail__raw" style={{ marginTop: 16 }}>{raw}</div>
      </div>
    </div>
  )
}
