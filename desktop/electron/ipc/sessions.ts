import { ipcMain, BrowserWindow } from 'electron'
import {
  getClaudeWatcher,
  getProcessWatcher,
  snapshot,
  startSessionWatchers,
} from '../sessions'

const CHANNEL_UPDATE = 'sessions:update'

export function registerSessionsIpc(): void {
  startSessionWatchers()

  // Push updates to every renderer when either watcher fires.
  const broadcast = () => {
    const payload = snapshot()
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(CHANNEL_UPDATE, payload)
    }
  }
  getClaudeWatcher().subscribe(broadcast)
  getProcessWatcher().subscribe(broadcast)

  ipcMain.handle('sessions:list', async () => {
    return snapshot()
  })

  ipcMain.handle(
    'sessions:tail',
    async (_evt, { sessionId, lines }: { sessionId: string; lines?: number }) => {
      return getClaudeWatcher().tail(sessionId, lines ?? 50)
    },
  )
}
