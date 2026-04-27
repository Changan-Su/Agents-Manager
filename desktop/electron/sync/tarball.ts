import { create as tarCreate, extract as tarExtract } from 'tar'
import { mkdtempSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, dirname } from 'node:path'

export interface TarManifestEntry {
  agentKind: string
  sourcePath: string
  archivePath: string
  sizeBytes: number
}

export interface TarballResult {
  buffer: Buffer
  manifest: TarManifestEntry[]
}

/**
 * Pack the given absolute file paths into a gzipped tarball, preserving the
 * agent-kind grouping and the relative path inside each agent root. The
 * tarball is built in a temp dir then read into a Buffer for encryption.
 */
export async function packTarball(
  entries: Array<{ agentKind: string; rootPath: string; absPath: string }>,
): Promise<TarballResult> {
  const stagingDir = mkdtempSync(join(tmpdir(), 'agents-manager-pack-'))
  const manifest: TarManifestEntry[] = []
  try {
    for (const entry of entries) {
      const relPath = relative(entry.rootPath, entry.absPath)
      if (relPath.startsWith('..') || relPath.includes('\0')) continue
      const archivePath = `${entry.agentKind}/${relPath}`
      const target = join(stagingDir, archivePath)
      mkdirSync(dirname(target), { recursive: true })
      const data = readFileSync(entry.absPath)
      // simple copy; symlinks are dereferenced by readFileSync
      const fs = await import('node:fs/promises')
      await fs.writeFile(target, data, { mode: 0o600 })
      manifest.push({
        agentKind: entry.agentKind,
        sourcePath: entry.absPath,
        archivePath,
        sizeBytes: data.length,
      })
    }

    const tarballPath = join(stagingDir, '_archive.tar.gz')
    await tarCreate(
      {
        gzip: true,
        cwd: stagingDir,
        file: tarballPath,
        portable: true,
        // Exclude the archive itself
        filter: (filePath) => !filePath.endsWith('_archive.tar.gz'),
      },
      ['.'],
    )
    const buffer = readFileSync(tarballPath)
    return { buffer, manifest }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

/**
 * Extract a tarball buffer to a fresh temp directory. Returns the directory
 * path; caller is responsible for cleaning it up.
 */
export async function unpackTarball(buffer: Buffer): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'agents-manager-unpack-'))
  // Write to temp file then extract — `tar` lib supports streaming but
  // we keep this simple and synchronous for now.
  const tarballPath = join(dir, '_archive.tar.gz')
  const fs = await import('node:fs/promises')
  await fs.writeFile(tarballPath, buffer, { mode: 0o600 })
  // tar's strict mode promotes warnings, but path traversal is silently
  // sanitised by default (leading `..` and absolute paths are stripped). We
  // explicitly reject any entry whose resolved path leaves `dir` so a
  // compromised blob cannot write outside the staging tree even if encrypted
  // with the user's correct passphrase.
  const { resolve, sep } = await import('node:path')
  const dirAbs = resolve(dir)
  await tarExtract({
    file: tarballPath,
    cwd: dir,
    strict: true,
    filter: (entryPath) => {
      const targetAbs = resolve(dir, entryPath)
      if (targetAbs !== dirAbs && !targetAbs.startsWith(dirAbs + sep)) {
        throw new Error(`refusing tar entry that escapes staging: ${entryPath}`)
      }
      return true
    },
    onwarn: (_code, msg) => {
      throw new Error(`tar warning: ${msg}`)
    },
  })
  if (existsSync(tarballPath)) await fs.unlink(tarballPath)
  return dir
}
