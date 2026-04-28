import { existsSync, readFileSync, readdirSync, statSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { exec } from 'node:child_process'
import type {
  ClaudeSession,
  SessionStatus,
  SessionEvent,
  SessionTailResponse,
} from '../../../shared/types'

const SESSIONS_DIR = join(homedir(), '.claude', 'sessions')
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const IDE_DIR = join(homedir(), '.claude', 'ide')

type Listener = (sessions: ClaudeSession[]) => void

/**
 * Watches `~/.claude/sessions/*.json` for live Claude Code sessions and
 * cross-checks each PID against `pgrep claude` so dead sessions are still
 * shown but flagged. Emits the full list whenever something changes.
 */
export class ClaudeSessionWatcher {
  private fsWatcher: FSWatcher | null = null
  private livenessTimer: NodeJS.Timeout | null = null
  private lastSessions: ClaudeSession[] = []
  private listeners = new Set<Listener>()
  private livePids = new Set<number>()
  private debounceTimer: NodeJS.Timeout | null = null

  start(): void {
    if (!existsSync(SESSIONS_DIR)) return
    this.fsWatcher = fsWatch(SESSIONS_DIR, { persistent: false }, () => this.scheduleRefresh())
    this.livenessTimer = setInterval(() => void this.refreshLiveness(), 5_000)
    void this.refreshLiveness().then(() => this.refreshSessionsSync())
  }

  stop(): void {
    this.fsWatcher?.close()
    this.fsWatcher = null
    if (this.livenessTimer) clearInterval(this.livenessTimer)
    this.livenessTimer = null
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    this.listeners.clear()
  }

  list(): ClaudeSession[] {
    if (!this.lastSessions.length) this.refreshSessionsSync()
    return this.lastSessions
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /**
   * Read the last `lines` events from the session's JSONL log. We deliberately
   * avoid passing back raw user/assistant content — it can contain secrets.
   * Instead we surface event types and a small preview field.
   */
  tail(sessionId: string, lines: number = 50): SessionTailResponse {
    const cwd = this.lastSessions.find((s) => s.sessionId === sessionId)?.cwd
    const candidates: string[] = []
    if (cwd) candidates.push(...this.candidateLogPaths(cwd, sessionId))
    // Fallback: walk all project dirs if cwd unknown.
    if (!candidates.length && existsSync(PROJECTS_DIR)) {
      for (const slug of safeReaddir(PROJECTS_DIR)) {
        candidates.push(join(PROJECTS_DIR, slug, `${sessionId}.jsonl`))
      }
    }
    const path = candidates.find((p) => existsSync(p))
    if (!path) {
      return { sessionId, events: [], truncated: false }
    }
    const raw = readFileSync(path, 'utf-8')
    const allLines = raw.split(/\r?\n/).filter(Boolean)
    const slice = allLines.slice(-Math.max(1, Math.min(lines, 500)))
    const events: SessionEvent[] = slice.map((line) => parseEventLine(line))
    return {
      sessionId,
      events,
      truncated: allLines.length > slice.length,
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private candidateLogPaths(cwd: string, sessionId: string): string[] {
    // Claude Code encodes cwd as a slash → dash slug under projects/.
    const slug = cwdToSlug(cwd)
    return [
      join(PROJECTS_DIR, slug, `${sessionId}.jsonl`),
      join(PROJECTS_DIR, `-${slug.replace(/^-+/, '')}`, `${sessionId}.jsonl`),
    ]
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.refreshSessionsSync(), 200)
  }

  private async refreshLiveness(): Promise<void> {
    try {
      this.livePids = await pgrepClaude()
    } catch {
      // pgrep unavailable on some platforms; assume all are alive.
      this.livePids = new Set(this.lastSessions.map((s) => s.pid))
    }
    // Re-emit if any session's alive flag changed.
    const updated = this.lastSessions.map((s) => ({ ...s, alive: this.livePids.has(s.pid) }))
    if (JSON.stringify(updated) !== JSON.stringify(this.lastSessions)) {
      this.lastSessions = updated
      this.emit()
    }
  }

  private refreshSessionsSync(): void {
    if (!existsSync(SESSIONS_DIR)) {
      this.lastSessions = []
      this.emit()
      return
    }
    const ideBindings = collectIdePids()
    const out: ClaudeSession[] = []
    for (const entry of safeReaddir(SESSIONS_DIR)) {
      if (!entry.endsWith('.json')) continue
      const path = join(SESSIONS_DIR, entry)
      try {
        const raw = readFileSync(path, 'utf-8')
        const data = JSON.parse(raw) as Partial<ClaudeSession> & { pid?: number; status?: string }
        if (typeof data.pid !== 'number' || typeof data.sessionId !== 'string') continue
        const status = normaliseStatus(data.status)
        out.push({
          pid: data.pid,
          alive: this.livePids.has(data.pid),
          sessionId: data.sessionId,
          cwd: data.cwd ?? '',
          startedAt: data.startedAt ?? statSafeMtime(path),
          updatedAt: data.updatedAt ?? statSafeMtime(path),
          status: this.livePids.has(data.pid) ? status : 'dead',
          name: data.name ?? undefined,
          hasIdeBinding: ideBindings.has(data.pid),
          recentEventTypes: this.peekRecentTypes(data.cwd ?? '', data.sessionId),
        })
      } catch {
        // skip — likely a write-in-progress
      }
    }
    out.sort((a, b) => statusRank(a) - statusRank(b) || b.updatedAt - a.updatedAt)
    this.lastSessions = out
    this.emit()
  }

  private peekRecentTypes(cwd: string, sessionId: string): string[] | undefined {
    if (!cwd) return undefined
    const path = this.candidateLogPaths(cwd, sessionId).find((p) => existsSync(p))
    if (!path) return undefined
    try {
      const raw = readFileSync(path, 'utf-8')
      const lines = raw.split(/\r?\n/).filter(Boolean).slice(-5)
      return lines.map((l) => parseEventLine(l).type)
    } catch {
      return undefined
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.lastSessions)
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function cwdToSlug(cwd: string): string {
  // Claude Code stores `~/.claude/projects/<cwd-with-slashes-replaced-by-dashes>/`.
  return cwd.replace(/\//g, '-')
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function statSafeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return Date.now()
  }
}

function normaliseStatus(s: unknown): SessionStatus {
  if (s === 'busy' || s === 'idle' || s === 'waiting') return s
  return 'idle'
}

function statusRank(s: ClaudeSession): number {
  if (!s.alive) return 9
  if (s.status === 'busy') return 0
  if (s.status === 'waiting') return 1
  return 2
}

function collectIdePids(): Set<number> {
  if (!existsSync(IDE_DIR)) return new Set()
  const out = new Set<number>()
  for (const entry of safeReaddir(IDE_DIR)) {
    const m = entry.match(/^(\d+)\.lock$/)
    if (m) out.add(Number(m[1]))
  }
  return out
}

async function pgrepClaude(): Promise<Set<number>> {
  return new Promise((resolve) => {
    exec('pgrep -x claude', (err, stdout) => {
      if (err && err.code !== 1) {
        resolve(new Set())
        return
      }
      const pids = new Set<number>()
      for (const line of stdout.split(/\r?\n/)) {
        const n = Number(line.trim())
        if (Number.isFinite(n)) pids.add(n)
      }
      resolve(pids)
    })
  })
}

function parseEventLine(line: string): SessionEvent {
  let obj: Record<string, unknown> = {}
  try {
    obj = JSON.parse(line) as Record<string, unknown>
  } catch {
    return { ts: 0, type: 'parse_error', preview: line.slice(0, 80) }
  }
  const type =
    (typeof obj.type === 'string' && obj.type) ||
    (typeof obj.event === 'string' && obj.event) ||
    'event'
  const ts =
    typeof obj.ts === 'number'
      ? obj.ts
      : typeof obj.timestamp === 'number'
        ? obj.timestamp
        : 0
  // Build a short preview: prefer `tool_name` / `name` / `path`, then the
  // first 80 chars of any string field. Never include `content` (model output)
  // or `message` (user input) in full to avoid leaking secrets.
  const preview =
    str(obj.tool_name) ||
    str(obj.name) ||
    str(obj.path) ||
    str(obj.command) ||
    str(obj.summary) ||
    Object.entries(obj)
      .filter(([k]) => !['content', 'message', 'text'].includes(k))
      .map(([k, v]) => `${k}=${truncate(String(v), 30)}`)
      .join(' ')
      .slice(0, 80)
  return { ts, type, preview }
}

function str(v: unknown): string {
  return typeof v === 'string' ? truncate(v, 80) : ''
}

function truncate(v: string, n: number): string {
  if (v.length <= n) return v
  return v.slice(0, n - 1) + '…'
}

// helper: keep `basename` in scope so esbuild doesn't tree-shake the import.
void basename
