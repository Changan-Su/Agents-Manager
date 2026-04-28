import { ipcMain, app } from 'electron'
import { hostname, platform, release } from 'node:os'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { adapters } from '../scanner/registry'
import { getSetting, setSetting } from '../db/queries'
import { encrypt, decrypt } from '../sync/encrypt'
import { packTarball, unpackTarball } from '../sync/tarball'
import { BackendClient, type HealthInfo } from '../sync/backendClient'
import type { Asset } from '../../../shared/types'

const KEY_BACKEND_URL = 'backend_url'
const KEY_API_KEY = 'backend_api_key'
const KEY_MACHINE_ID = 'machine_id'

function getOrCreateMachineId(): string {
  let id = getSetting(KEY_MACHINE_ID)
  if (!id) {
    id = randomUUID()
    setSetting(KEY_MACHINE_ID, id)
  }
  return id
}

function getMachineLabel(): string {
  return hostname() || 'unknown'
}

function getOsLabel(): string {
  return `${platform()} ${release()}`
}

function makeClient(): BackendClient {
  const url = getSetting(KEY_BACKEND_URL)
  const apiKey = getSetting(KEY_API_KEY)
  if (!url || !apiKey) throw new Error('backend not connected — open Sync to connect')
  return new BackendClient(url, apiKey, getOrCreateMachineId())
}

function isInsideAgentRoot(absPath: string, root: string): boolean {
  const a = absPath.endsWith('/') ? absPath : absPath + '/'
  const r = root.endsWith('/') ? root : root + '/'
  return a === r || absPath === root || a.startsWith(r)
}

async function detectAgentRoots(): Promise<string[]> {
  const roots: string[] = []
  for (const a of adapters) {
    const det = await a.detect()
    if (det.present) roots.push(det.root)
  }
  return roots
}

function isInsideAnyRoot(absPath: string, roots: string[]): boolean {
  return roots.some((r) => isInsideAgentRoot(absPath, r))
}

export function registerSyncIpc(): void {
  ipcMain.handle(
    'sync:connect',
    async (_evt, { backendUrl, apiKey }: { backendUrl: string; apiKey: string }) => {
      const url = backendUrl.trim().replace(/\/$/, '')
      if (!url) throw new Error('backendUrl required')
      if (!apiKey || apiKey.length < 16) {
        throw new Error('apiKey must be at least 16 characters')
      }
      const machineId = getOrCreateMachineId()

      // 1. probe /health (no auth) — surfaces typos / wrong port quickly.
      const probe = new BackendClient(url, null, null)
      let health: HealthInfo
      try {
        health = await probe.health()
      } catch (e) {
        throw new Error(`cannot reach ${url}/api/health: ${(e as Error).message}`)
      }

      // 2. verify the api key against an authed endpoint.
      const authed = new BackendClient(url, apiKey, machineId)
      await authed.verifyKey()

      setSetting(KEY_BACKEND_URL, url)
      setSetting(KEY_API_KEY, apiKey)
      return { ok: true, health, machineId }
    },
  )

  ipcMain.handle('sync:disconnect', async () => {
    setSetting(KEY_BACKEND_URL, '')
    setSetting(KEY_API_KEY, '')
    return { ok: true }
  })

  ipcMain.handle('sync:status', async () => {
    const url = getSetting(KEY_BACKEND_URL)
    const apiKey = getSetting(KEY_API_KEY)
    const machineId = getOrCreateMachineId()
    const machineLabel = getMachineLabel()

    if (!url || !apiKey) {
      return { connected: false, machineId, machineLabel }
    }
    try {
      const client = makeClient()
      const health = await client.health()
      // Cheap auth check — the call also succeeds with a stale key (since
      // /health is public), so do a separate authed probe.
      await client.verifyKey()
      return {
        connected: true,
        backendUrl: url,
        machineId,
        machineLabel,
        health,
      }
    } catch (e) {
      return {
        connected: false,
        backendUrl: url,
        machineId,
        machineLabel,
        error: (e as Error).message,
      }
    }
  })

  ipcMain.handle(
    'sync:push',
    async (_evt, { passphrase }: { passphrase: string }) => {
      if (!passphrase || passphrase.length < 8) {
        throw new Error('passphrase must be at least 8 characters')
      }
      const client = makeClient()
      const machineId = getOrCreateMachineId()

      const inventory: Array<{ kind: string; counts: Record<string, number>; version?: string }> = []
      const tarEntries: Array<{ agentKind: string; rootPath: string; absPath: string }> = []

      for (const adapter of adapters) {
        const det = await adapter.detect()
        if (!det.present) continue
        const r = await adapter.scan(det)

        const allAssets: Asset[] = [
          ...r.agents,
          ...r.skills,
          ...r.plugins,
          ...r.commands,
          ...r.hooks,
          ...(r.settings ? [r.settings] : []),
        ]
        for (const a of allAssets) {
          if (!existsSync(a.sourcePath)) continue
          if (!isInsideAgentRoot(a.sourcePath, det.root)) continue
          tarEntries.push({
            agentKind: a.agentKind as string,
            rootPath: det.root,
            absPath: a.sourcePath,
          })
        }
        inventory.push({
          kind: det.kind,
          counts: {
            agents: r.agents.length,
            skills: r.skills.length,
            plugins: r.plugins.length,
            commands: r.commands.length,
            hooks: r.hooks.length,
            mcpServers: r.mcpServers.length,
          },
          version: det.version,
        })
      }

      if (tarEntries.length === 0) throw new Error('nothing to back up — scan first')

      const { buffer, manifest: tarManifest } = await packTarball(tarEntries)
      const { ciphertext, metadata } = encrypt(buffer, passphrase)
      const blob = await client.uploadBlob(ciphertext)

      let snap
      try {
        snap = await client.createSnapshot({
          blobId: blob.blobId,
          machineId,
          machineLabel: getMachineLabel(),
          os: getOsLabel(),
          manifest: {
            agentInventory: inventory,
            encryption: metadata,
            clientVersion: app.getVersion(),
            createdAt: Date.now(),
          },
          sizeBytes: ciphertext.length,
        })
      } catch (snapshotErr) {
        // Best-effort cleanup of the orphan blob.
        try {
          await client.deleteBlob(blob.blobId)
        } catch {
          // ignore — the orphan will surface on next admin review.
        }
        throw snapshotErr
      }

      return {
        snapshotId: snap.id,
        blobId: blob.blobId,
        sizeBytes: ciphertext.length,
        plainSizeBytes: buffer.length,
        fileCount: tarManifest.length,
      }
    },
  )

  ipcMain.handle('sync:list', async (_evt, { machineId }: { machineId?: string } = {}) => {
    const client = makeClient()
    const result = await client.listSnapshots(machineId)
    return result.snapshots
  })

  ipcMain.handle('sync:listMachines', async () => {
    const client = makeClient()
    const r = await client.listMachines()
    return r.machines
  })

  ipcMain.handle(
    'sync:pull',
    async (
      _evt,
      { snapshotId, passphrase }: { snapshotId: string; passphrase: string },
    ) => {
      const client = makeClient()
      const snap = await client.getSnapshot(snapshotId)
      const ciphertext = await client.downloadBlob(snap.blobId)
      const plaintext = decrypt(ciphertext, passphrase)
      const stagingDir = await unpackTarball(plaintext)
      return { stagingDir, manifest: snap.manifest }
    },
  )

  ipcMain.handle(
    'sync:apply',
    async (
      _evt,
      {
        stagingDir,
        targets,
      }: { stagingDir: string; targets: Array<{ archiveRel: string; absPath: string }> },
    ) => {
      const { resolve } = await import('node:path')
      const { tmpdir } = await import('node:os')
      const stagingAbs = resolve(stagingDir)
      const tmpAbs = resolve(tmpdir())
      if (!stagingAbs.startsWith(tmpAbs)) {
        throw new Error('refusing apply: stagingDir is not under the OS tmpdir')
      }
      const knownRoots = await detectAgentRoots()
      const applied: Array<{ archiveRel: string; absPath: string; backupPath?: string }> = []
      const errors: string[] = []
      for (const t of targets) {
        try {
          const src = resolve(stagingAbs, t.archiveRel)
          if (!src.startsWith(stagingAbs + '/') && src !== stagingAbs) {
            errors.push(`refusing source outside staging: ${t.archiveRel}`)
            continue
          }
          const targetAbs = resolve(t.absPath)
          if (!isInsideAnyRoot(targetAbs, knownRoots)) {
            errors.push(`refusing target outside agent roots: ${t.absPath}`)
            continue
          }
          if (!existsSync(src)) {
            errors.push(`missing in staging: ${t.archiveRel}`)
            continue
          }
          let backupPath: string | undefined
          if (existsSync(targetAbs)) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-')
            backupPath = `${targetAbs}.bak.${ts}.pre-restore`
            copyFileSync(targetAbs, backupPath)
          } else {
            mkdirSync(dirname(targetAbs), { recursive: true })
          }
          copyFileSync(src, targetAbs)
          applied.push({ archiveRel: t.archiveRel, absPath: targetAbs, backupPath })
        } catch (e) {
          errors.push(`${t.archiveRel}: ${(e as Error).message}`)
        }
      }
      return { applied, errors }
    },
  )

  ipcMain.handle(
    'sync:delete',
    async (_evt, { snapshotId }: { snapshotId: string }) => {
      const client = makeClient()
      return client.deleteSnapshot(snapshotId)
    },
  )
}
