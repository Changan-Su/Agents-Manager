import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { adapters } from '../scanner/registry'
import {
  recordScan,
  upsertAssets,
  upsertMcpServers,
  getLatestScanSummary,
} from '../db/queries'
import type {
  AgentSummary,
  ScanResponse,
} from '../../../shared/types'

export function registerScanIpc(): void {
  ipcMain.handle('scan:run', async () => {
    const startedAt = Date.now()
    const scanId = randomUUID()
    const summary: AgentSummary[] = []

    for (const adapter of adapters) {
      const detection = await adapter.detect()
      if (!detection.present) {
        summary.push({
          kind: adapter.kind,
          present: false,
          root: detection.root,
          counts: {
            agents: 0,
            skills: 0,
            plugins: 0,
            commands: 0,
            hooks: 0,
            mcpServers: 0,
          },
          errors: [],
        })
        continue
      }

      const result = await adapter.scan(detection)
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

      summary.push({
        kind: adapter.kind,
        present: true,
        root: detection.root,
        counts: {
          agents: result.agents.length,
          skills: result.skills.length,
          plugins: result.plugins.length,
          commands: result.commands.length,
          hooks: result.hooks.length,
          mcpServers: result.mcpServers.length,
        },
        errors: result.errors,
      })
    }

    const finishedAt = Date.now()
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
