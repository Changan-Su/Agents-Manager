import { ipcMain, shell } from 'electron'
import { copyFileSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import TOML from '@iarna/toml'
import {
  findAssetById,
  listAssetsByAgentAndKind,
  listMcpServers,
  recordEdit,
  listEdits,
  updateAssetHashAfterEdit,
  getSetting,
  setSetting,
} from '../db/queries'
import type { AssetReadResponse } from '../../../shared/types'

const EDIT_ENABLED_KEY = 'edit_enabled'

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function validateContentForExt(path: string, content: string): { ok: true } | { ok: false; error: string } {
  const lower = path.toLowerCase()
  try {
    if (lower.endsWith('.json')) {
      JSON.parse(content)
    } else if (lower.endsWith('.toml')) {
      TOML.parse(content)
    }
    // Markdown / shell / unknown — no validation. Caller writes at own risk.
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// Restrict backup paths to the canonical `<sourcePath>.bak.<ts>` (and
// `.pre-revert` / `.pre-restore` suffixes we generate ourselves). Without this,
// a compromised renderer could pass /etc/passwd as `backupPath` and read or
// overwrite arbitrary files via asset:revert / asset:readBackup.
function isValidBackupForAsset(sourcePath: string, backupPath: string): boolean {
  const sourceAbs = resolve(sourcePath)
  const bakAbs = resolve(backupPath)
  if (resolve(dirname(bakAbs)) !== resolve(dirname(sourceAbs))) return false
  const base = basename(sourceAbs)
  const bakBase = basename(bakAbs)
  // Match "<base>.bak.<timestamp>" or with .pre-revert / .pre-restore suffix.
  return new RegExp(
    `^${base.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\.bak\\.[0-9TZ:.-]+(?:\\.(?:pre-revert|pre-restore))?$`,
  ).test(bakBase)
}

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

  ipcMain.handle(
    'asset:write',
    async (_evt, { assetId, content }: { assetId: string; content: string }) => {
      if (getSetting(EDIT_ENABLED_KEY) !== 'true') {
        throw new Error('Editing is disabled. Enable it in Settings first.')
      }
      const asset = findAssetById(assetId)
      if (!asset) throw new Error(`asset not found: ${assetId}`)

      const validation = validateContentForExt(asset.sourcePath, content)
      if (!validation.ok) {
        throw new Error(`syntax check failed: ${validation.error}`)
      }

      let beforeRaw = ''
      try {
        beforeRaw = readFileSync(asset.sourcePath, 'utf-8')
      } catch (e) {
        throw new Error(`cannot read original file: ${(e as Error).message}`)
      }
      const beforeHash = sha256(beforeRaw)
      const afterHash = sha256(content)

      // 1. backup
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = `${asset.sourcePath}.bak.${ts}`
      copyFileSync(asset.sourcePath, backupPath)

      // 2. atomic write — temp file in same dir + rename
      const tmpPath = join(
        dirname(asset.sourcePath),
        `.${basename(asset.sourcePath)}.tmp-${randomUUID()}`,
      )
      writeFileSync(tmpPath, content, 'utf-8')
      renameSync(tmpPath, asset.sourcePath)

      // 3. record + bump cached hash
      const editId = randomUUID()
      recordEdit(editId, assetId, beforeHash, afterHash, backupPath)
      updateAssetHashAfterEdit(assetId, afterHash)

      return { editId, backupPath, beforeHash, afterHash }
    },
  )

  ipcMain.handle('asset:listBackups', async (_evt, { assetId }: { assetId: string }) => {
    return listEdits(assetId)
  })

  ipcMain.handle(
    'asset:revert',
    async (_evt, { assetId, backupPath }: { assetId: string; backupPath: string }) => {
      if (getSetting(EDIT_ENABLED_KEY) !== 'true') {
        throw new Error('Editing is disabled. Enable it in Settings first.')
      }
      const asset = findAssetById(assetId)
      if (!asset) throw new Error(`asset not found: ${assetId}`)
      if (!isValidBackupForAsset(asset.sourcePath, backupPath)) {
        throw new Error('refusing to restore from a path that is not a known backup')
      }
      if (!existsSync(backupPath)) throw new Error(`backup not found: ${backupPath}`)

      const backupRaw = readFileSync(backupPath, 'utf-8')
      const beforeRaw = readFileSync(asset.sourcePath, 'utf-8')
      const beforeHash = sha256(beforeRaw)
      const afterHash = sha256(backupRaw)

      // create a "rollback backup" of the current state before reverting
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const rollbackBackup = `${asset.sourcePath}.bak.${ts}.pre-revert`
      copyFileSync(asset.sourcePath, rollbackBackup)

      const tmpPath = join(
        dirname(asset.sourcePath),
        `.${basename(asset.sourcePath)}.tmp-${randomUUID()}`,
      )
      writeFileSync(tmpPath, backupRaw, 'utf-8')
      renameSync(tmpPath, asset.sourcePath)

      const editId = randomUUID()
      recordEdit(editId, assetId, beforeHash, afterHash, rollbackBackup)
      updateAssetHashAfterEdit(assetId, afterHash)

      return { editId, rollbackBackup }
    },
  )

  ipcMain.handle(
    'asset:readBackup',
    async (_evt, { assetId, backupPath }: { assetId: string; backupPath: string }) => {
      const asset = findAssetById(assetId)
      if (!asset) throw new Error(`asset not found: ${assetId}`)
      if (!isValidBackupForAsset(asset.sourcePath, backupPath)) {
        throw new Error('refusing to read a path that is not a known backup')
      }
      if (!existsSync(backupPath)) throw new Error(`backup not found: ${backupPath}`)
      return { raw: readFileSync(backupPath, 'utf-8') }
    },
  )

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

  ipcMain.handle('settings:get', async (_evt, { key }: { key: string }) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', async (_evt, { key, value }: { key: string; value: string }) => {
    setSetting(key, value)
    return { ok: true }
  })
}
