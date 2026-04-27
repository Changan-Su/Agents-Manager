import { ipcMain, app } from 'electron'
import { hostname, platform, release } from 'node:os'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { adapters } from '../scanner/registry'
import {
  getSetting,
  setSetting,
} from '../db/queries'
import { encrypt, decrypt } from '../sync/encrypt'
import { packTarball, unpackTarball } from '../sync/tarball'
import { BackendClient } from '../sync/backendClient'
import type { SnapshotMeta } from '../sync/backendClient'
import type { Asset, AgentKind } from '../../../shared/types'

const KEY_BACKEND_URL = 'backend_url'
const KEY_BACKEND_TOKEN = 'backend_token'
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
  const token = getSetting(KEY_BACKEND_TOKEN)
  if (!url) throw new Error('backend not configured')
  return new BackendClient(url, token)
}

function isInsideAgentRoot(absPath: string, root: string): boolean {
  const a = absPath.endsWith('/') ? absPath : absPath + '/'
  const r = root.endsWith('/') ? root : root + '/'
  return a === r || absPath === root || a.startsWith(r)
}

// Recompute the set of legitimate agent roots so sync:apply can refuse to
// write outside any known agent's root directory. Without this gate, a
// compromised renderer could call sync:apply with absPath=/etc/passwd.
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
    'sync:configure',
    async (_evt, { backendUrl }: { backendUrl: string }) => {
      const url = backendUrl.replace(/\/$/, '')
      const probe = new BackendClient(url)
      const health = await probe.health()
      setSetting(KEY_BACKEND_URL, url)
      return { ok: true, health }
    },
  )

  ipcMain.handle(
    'sync:login',
    async (_evt, { email, password }: { email: string; password: string }) => {
      const url = getSetting(KEY_BACKEND_URL)
      if (!url) throw new Error('backend not configured')
      const client = new BackendClient(url)
      const { token, user } = await client.login(email, password)
      setSetting(KEY_BACKEND_TOKEN, token)
      return { user }
    },
  )

  ipcMain.handle(
    'sync:register',
    async (_evt, { email, password }: { email: string; password: string }) => {
      const url = getSetting(KEY_BACKEND_URL)
      if (!url) throw new Error('backend not configured')
      const client = new BackendClient(url)
      const { token, user } = await client.register(email, password)
      setSetting(KEY_BACKEND_TOKEN, token)
      return { user }
    },
  )

  ipcMain.handle('sync:status', async () => {
    const url = getSetting(KEY_BACKEND_URL)
    const token = getSetting(KEY_BACKEND_TOKEN)
    if (!url) return { configured: false, signedIn: false }
    if (!token) return { configured: true, signedIn: false, backendUrl: url }
    try {
      const client = makeClient()
      const me = await client.me()
      return {
        configured: true,
        signedIn: true,
        backendUrl: url,
        user: me,
        machineId: getOrCreateMachineId(),
        machineLabel: getMachineLabel(),
      }
    } catch (e) {
      return {
        configured: true,
        signedIn: false,
        backendUrl: url,
        error: (e as Error).message,
      }
    }
  })

  ipcMain.handle('sync:logout', async () => {
    setSetting(KEY_BACKEND_TOKEN, '')
    return { ok: true }
  })

  ipcMain.handle(
    'sync:push',
    async (_evt, { passphrase }: { passphrase: string }) => {
      if (!passphrase || passphrase.length < 8) {
        throw new Error('passphrase must be at least 8 characters')
      }
      const client = makeClient()

      // 1) Build a fresh inventory + collect all source files
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

      // 2) Pack tarball
      const { buffer, manifest: tarManifest } = await packTarball(tarEntries)

      // 3) Encrypt
      const { ciphertext, metadata } = encrypt(buffer, passphrase)

      // 4) Upload blob
      const blob = await client.uploadBlob(ciphertext)

      // 5) Register snapshot — if this fails, delete the orphan blob.
      let snap
      try {
        snap = await client.createSnapshot({
          blobId: blob.blobId,
          machineId: getOrCreateMachineId(),
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
        // Best-effort cleanup of the orphan blob. Surface both errors.
        try {
          // BackendClient doesn't expose deleteBlob — call the endpoint directly.
          const url = getSetting(KEY_BACKEND_URL)
          const token = getSetting(KEY_BACKEND_TOKEN)
          if (url && token) {
            await fetch(`${url}/api/blobs/${encodeURIComponent(blob.blobId)}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            })
          }
        } catch {
          // ignore — surfaces in next admin review of orphan blobs
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
      // Reject staging paths we didn't create — sync:pull always returns a
      // tmpdir under os.tmpdir(); refuse anything else.
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
          // archiveRel must not escape the staging dir
          const src = resolve(stagingAbs, t.archiveRel)
          if (!src.startsWith(stagingAbs + '/') && src !== stagingAbs) {
            errors.push(`refusing source outside staging: ${t.archiveRel}`)
            continue
          }
          // absPath must land inside a known agent root
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

export type { SnapshotMeta }
