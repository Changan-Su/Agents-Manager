import { ipcMain, shell } from 'electron'
import { readFileSync } from 'node:fs'
import {
  findAssetById,
  listAssetsByAgentAndKind,
  listMcpServers,
} from '../db/queries'
import type { AssetReadResponse } from '../../../shared/types'

export function registerAssetIpc(): void {
  ipcMain.handle(
    'asset:list',
    async (_evt, { agentKind, kind }: { agentKind: string; kind?: string }) => {
      return listAssetsByAgentAndKind(agentKind, kind)
    },
  )

  ipcMain.handle('asset:read', async (_evt, { assetId }: { assetId: string }) => {
    const asset = findAssetById(assetId)
    if (!asset) throw new Error(`asset not found: ${assetId}`)
    let raw = ''
    try {
      raw = readFileSync(asset.sourcePath, 'utf-8')
    } catch (e) {
      raw = `// failed to read source: ${(e as Error).message}`
    }
    const response: AssetReadResponse = { raw, parsed: asset, sourcePath: asset.sourcePath }
    return response
  })

  ipcMain.handle('mcp:list', async (_evt, { agentKind }: { agentKind?: string } = {}) => {
    return listMcpServers(agentKind)
  })

  ipcMain.handle('fs:openInFinder', async (_evt, { path }: { path: string }) => {
    shell.showItemInFolder(path)
    return { ok: true }
  })

  ipcMain.handle('fs:openPath', async (_evt, { path }: { path: string }) => {
    const err = await shell.openPath(path)
    return { ok: err === '', error: err || undefined }
  })
}
