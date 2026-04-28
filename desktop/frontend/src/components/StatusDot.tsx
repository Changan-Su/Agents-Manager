interface StatusDotProps {
  kind: 'ok' | 'busy' | 'idle' | 'error' | 'dead'
  label?: string
  size?: number
}

const COLOR: Record<StatusDotProps['kind'], string> = {
  ok: 'var(--badge-green-fg)',
  busy: 'var(--badge-green-fg)',
  idle: 'var(--text-muted)',
  error: 'var(--badge-red-fg)',
  dead: 'var(--text-subtle)',
}

export function StatusDot({ kind, label, size = 8 }: StatusDotProps) {
  const color = COLOR[kind]
  const isPulsing = kind === 'busy'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          boxShadow: isPulsing ? `0 0 0 3px ${color}33` : undefined,
          animation: isPulsing ? 'amgr-pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {label ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span> : null}
    </span>
  )
}
