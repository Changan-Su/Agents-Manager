import { useEffect, useState } from 'react'

type Mode = 'light' | 'dark'

const STORAGE_KEY = 'agents_manager_mode'

function readInitialMode(): Mode {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage.getItem(STORAGE_KEY) as Mode | null
  if (stored === 'light' || stored === 'dark') return stored
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  return 'dark'
}

function applyMode(mode: Mode) {
  document.documentElement.setAttribute('data-mode', mode)
  document.documentElement.setAttribute('data-theme', 'qbird')
}

export function ModeToggle() {
  const [mode, setMode] = useState<Mode>(readInitialMode)

  useEffect(() => {
    applyMode(mode)
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  const next = mode === 'dark' ? 'light' : 'dark'
  return (
    <button
      className="btn btn--icon"
      title={`Switch to ${next} mode`}
      onClick={() => setMode(next)}
      aria-label="Toggle color mode"
    >
      {mode === 'dark' ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}
