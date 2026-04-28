import { exec } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { AgentKind, ProcessRow } from '../../../shared/types'

type Listener = (rows: ProcessRow[]) => void

const PATTERNS: Array<{ kind: AgentKind | 'unknown'; rx: RegExp }> = [
  { kind: 'codex', rx: /\b(codex|codex-cli|@openai\/codex)\b/i },
  { kind: 'opencode', rx: /\b(opencode|opencode-ai)\b/i },
  { kind: 'openclaw', rx: /\b(openclaw)\b/i },
]

/**
 * Coarse process probe for non-Claude-Code agents (Codex / OpenCode / OpenClaw).
 * We don't have a shared session-on-disk format for those, so we just look at
 * `ps` and try to attribute each PID to a known agent kind.
 */
export class ProcessWatcher {
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<Listener>()
  private last: ProcessRow[] = []

  start(): void {
    void this.refresh().then(() => this.timer ??= setInterval(() => void this.refresh(), 8_000))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listeners.clear()
  }

  list(): ProcessRow[] {
    return this.last
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private async refresh(): Promise<void> {
    const pids = await psList()
    const out: ProcessRow[] = []
    for (const row of pids) {
      // Only surface CLI agents that aren't already covered by ClaudeSessionWatcher
      // (which has richer info). The renderer dedupes on PID, so it's harmless
      // if we include claude here — but keep it simple by just listing the
      // others.
      const kind = matchKind(row.command)
      if (kind === 'unknown') continue
      if (kind === 'claude-code') continue
      out.push({
        pid: row.pid,
        agentKind: kind,
        cwd: readCwd(row.pid),
        command: row.command,
        startedAt: row.startedAt,
      })
    }
    this.last = out
    for (const cb of this.listeners) cb(out)
  }
}

interface RawPs {
  pid: number
  command: string
  startedAt: number
}

function matchKind(command: string): AgentKind | 'unknown' {
  for (const p of PATTERNS) {
    if (p.rx.test(command)) return p.kind
  }
  return 'unknown'
}

async function psList(): Promise<RawPs[]> {
  return new Promise((resolve) => {
    // -o pid,lstart,args  — args is the full command line including any node
    // wrapper, which is what we want for pattern matching.
    exec("ps -eo pid=,lstart=,args= 2>/dev/null", (err, stdout) => {
      if (err) {
        resolve([])
        return
      }
      const out: RawPs[] = []
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^\s*(\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/)
        if (!m) continue
        const pid = Number(m[1])
        const startedAt = Date.parse(m[2])
        const command = m[3]
        if (!Number.isFinite(pid)) continue
        out.push({ pid, command, startedAt: Number.isFinite(startedAt) ? startedAt : 0 })
      }
      resolve(out)
    })
  })
}

function readCwd(pid: number): string | null {
  // Linux exposes /proc/<pid>/cwd as a symlink. Macs don't have /proc; we
  // accept null there.
  try {
    const fs = require('node:fs') as typeof import('node:fs')
    return fs.readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

// Avoid TS unused-warning for the readFileSync re-export above.
void readFileSync
