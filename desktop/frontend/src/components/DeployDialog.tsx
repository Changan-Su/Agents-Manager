import { useEffect, useState } from 'react'
import type { AgentSummary, DeployTarget, RepositoryItem } from '@shared/types'
import { useScanStore } from '../stores/scanStore'

interface DeployDialogProps {
  item: RepositoryItem
  onClose: () => void
  onDeployed: () => void
}

const KIND_LABEL: Record<AgentSummary['kind'], string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
}

export function DeployDialog({ item, onClose, onDeployed }: DeployDialogProps) {
  const agents = useScanStore((s) => s.agents)
  const [targets, setTargets] = useState<Record<string, boolean>>({})
  const [projectPath, setProjectPath] = useState('')
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Default-select Claude Code if it's installed.
    const claude = agents.find((a) => a.kind === 'claude-code' && a.present)
    if (claude) setTargets({ 'claude-code': true })
  }, [agents])

  function toggle(kind: string) {
    setTargets((cur) => ({ ...cur, [kind]: !cur[kind] }))
  }

  async function deploy() {
    setError(null)
    setResult(null)
    setRunning(true)
    try {
      const list: DeployTarget[] = Object.entries(targets)
        .filter(([, on]) => on)
        .map(([kind]) => ({
          agentKind: kind as DeployTarget['agentKind'],
          scope,
          projectPath: scope === 'project' ? projectPath.trim() : undefined,
        }))
      if (list.length === 0) {
        setError('Pick at least one agent.')
        return
      }
      if (scope === 'project' && !projectPath.trim()) {
        setError('Enter the project path.')
        return
      }
      const r = await window.api.repository.deploy(item.id, list)
      const lines: string[] = []
      for (const a of r.applied) lines.push(`✓ ${a.agentKind}/${a.scope} → ${a.targetPath}`)
      for (const e of r.errors) lines.push(`✗ ${e}`)
      setResult(lines.join('\n'))
      onDeployed()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const detected = agents.filter((a) => a.present)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2 style={{ margin: 0, fontSize: 16 }}>Deploy {item.name}</h2>
          <button className="btn btn--ghost" onClick={onClose}>×</button>
        </header>

        <section className="modal__body">
          <div className="muted small">Kind: {item.kind}</div>

          <div className="section-title" style={{ marginTop: 16 }}>Targets</div>
          {detected.length === 0 ? (
            <div className="muted">No agents installed yet — run a scan first.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {detected.map((a) => (
                <label
                  key={a.kind}
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={!!targets[a.kind]}
                    onChange={() => toggle(a.kind)}
                  />
                  <span style={{ fontWeight: 500 }}>{KIND_LABEL[a.kind]}</span>
                  <span className="muted small mono">{a.root}</span>
                </label>
              ))}
            </div>
          )}

          <div className="section-title" style={{ marginTop: 16 }}>Scope</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={scope === 'user' ? 'btn btn--primary' : 'btn'}
              onClick={() => setScope('user')}
            >
              User-level
            </button>
            <button
              className={scope === 'project' ? 'btn btn--primary' : 'btn'}
              onClick={() => setScope('project')}
            >
              Project-level
            </button>
          </div>
          {scope === 'project' ? (
            <input
              style={{
                marginTop: 8,
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-sub)',
                background: 'var(--input-bg)',
                color: 'var(--text)',
                fontFamily: 'monospace',
                fontSize: 12,
              }}
              placeholder="/absolute/path/to/project"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
            />
          ) : null}

          {error ? <div className="error-banner" style={{ marginTop: 12 }}>{error}</div> : null}
          {result ? (
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                background: 'var(--bg-alt)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {result}
            </pre>
          ) : null}
        </section>

        <footer className="modal__footer">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn--primary"
            disabled={running}
            onClick={() => void deploy()}
          >
            {running ? 'Deploying…' : 'Deploy'}
          </button>
        </footer>
      </div>
    </div>
  )
}
