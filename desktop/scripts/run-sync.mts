// End-to-end smoke test for Sprint 3 sync layer.
// Runs entirely against a local backend started separately (see assertion below).
// Skips Electron-specific bits (settings store) by injecting a mock.

import { encrypt, decrypt } from '../electron/sync/encrypt'
import { packTarball, unpackTarball } from '../electron/sync/tarball'
import { BackendClient } from '../electron/sync/backendClient'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BACKEND_URL ?? 'http://localhost:8788'
const EMAIL = process.env.BACKEND_EMAIL ?? `e2e-${Date.now()}@example.com`
const PASSWORD = process.env.BACKEND_PASSWORD ?? 'password123'
const PASSPHRASE = process.env.SNAPSHOT_PASSPHRASE ?? 'correct-horse-battery-staple'

async function main() {
  console.log('[1/8] health probe', BASE)
  const probe = new BackendClient(BASE)
  const h = await probe.health()
  console.log('  →', h)

  console.log('[2/8] register / login')
  const client = new BackendClient(BASE)
  try {
    await client.register(EMAIL, PASSWORD)
    console.log('  registered new user')
  } catch (e) {
    // 409 / 403 → fall back to login
    await client.login(EMAIL, PASSWORD)
    console.log('  logged in existing user')
  }

  console.log('[3/8] enumerate ~/.claude skills for tarball test')
  const claudeRoot = join(homedir(), '.claude')
  const skills = existsSync(join(claudeRoot, 'skills'))
    ? readdirSync(join(claudeRoot, 'skills'))
        .map((d) => join(claudeRoot, 'skills', d, 'SKILL.md'))
        .filter(existsSync)
    : []
  // Cap at 5 files to keep the test snappy
  const sample = skills.slice(0, 5)
  console.log(`  packing ${sample.length} sample SKILL.md files`)

  console.log('[4/8] pack + encrypt')
  const { buffer: tar } = await packTarball(
    sample.map((s) => ({
      agentKind: 'claude-code',
      rootPath: claudeRoot,
      absPath: s,
    })),
  )
  const { ciphertext, metadata } = encrypt(tar, PASSPHRASE)
  console.log(`  plain=${tar.length}B  cipher=${ciphertext.length}B  algo=${metadata.algorithm}`)

  console.log('[5/8] upload blob')
  const blob = await client.uploadBlob(ciphertext)
  console.log('  →', blob)

  console.log('[6/8] create snapshot')
  const snap = await client.createSnapshot({
    blobId: blob.blobId,
    machineId: 'e2e-machine',
    machineLabel: 'e2e',
    os: 'linux test',
    manifest: {
      agentInventory: [{ kind: 'claude-code', counts: { skills: sample.length } }],
      encryption: metadata,
      clientVersion: '0.1.0',
      createdAt: Date.now(),
    },
    sizeBytes: ciphertext.length,
  })
  console.log('  →', snap)

  console.log('[7/8] download + decrypt + unpack')
  const dl = await client.downloadBlob(blob.blobId)
  if (dl.length !== ciphertext.length) throw new Error('download size mismatch')
  const plain = decrypt(dl, PASSPHRASE)
  if (plain.length !== tar.length) throw new Error('decrypt size mismatch')
  if (Buffer.compare(plain, tar) !== 0) throw new Error('decrypt content mismatch')
  const dir = await unpackTarball(plain)
  console.log('  unpacked to', dir)

  console.log('[8/8] verify a known file is present in the staging dir')
  if (sample.length > 0) {
    const first = sample[0]
    const rel = first.replace(claudeRoot + '/', '')
    const stagedPath = join(dir, 'claude-code', rel)
    if (!existsSync(stagedPath)) throw new Error(`expected file missing in staging: ${stagedPath}`)
    const a = readFileSync(first)
    const b = readFileSync(stagedPath)
    if (Buffer.compare(a, b) !== 0) throw new Error('round-trip content differs')
    console.log('  ✓ round-trip OK')
  }

  console.log('\nALL CHECKS PASSED')
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
