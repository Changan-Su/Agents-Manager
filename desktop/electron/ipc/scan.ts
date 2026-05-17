import { ipcMain } from 'electron'
import { runScan } from '../core/scan'
import {
  recordScan,
  upsertAssets,
  upsertMcpServers,
  getLatestScanSummary,
} from '../db/queries'
import type { ScanResponse } from '../../../shared/types'

export function registerScanIpc(): void {
  ipcMain.handle('scan:run', async () => {
    const { scanId, startedAt, finishedAt, summary, perAgent } = await runScan()

    for (const result of perAgent) {
      if (!result.detection.present) continue
      const allAssets = [
        ...result.agents,
        ...result.skills,
        ...result.plugins,
        ...result.commands,
        ...result.hooks,
        ...(result.settings ? [result.settings] : []),
      ]
      upsertAssets(allAssets, scanId)
      upsertMcpServers(result.mcpServers, scanId)
    }

    recordScan(scanId, startedAt, finishedAt, summary)

    const response: ScanResponse = {
      scanId,
      startedAt,
      finishedAt,
      agents: summary,
    }
    return response
  })

  ipcMain.handle('scan:lastSummary', async () => {
    return getLatestScanSummary()
  })
}
