import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { openDatabase, closeDatabase } from './db/migrate'
import { registerScanIpc } from './ipc/scan'
import { registerAssetIpc } from './ipc/asset'
import { registerSyncIpc } from './ipc/sync'
import { registerSessionsIpc } from './ipc/sessions'
import { registerRepositoryIpc } from './ipc/repository'
import { stopSessionWatchers } from './sessions'

let mainWindow: BrowserWindow | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1C1C1E',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'agents-manager.db')
  openDatabase(dbPath)

  registerScanIpc()
  registerAssetIpc()
  registerSyncIpc()
  registerSessionsIpc()
  registerRepositoryIpc()

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  stopSessionWatchers()
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})
