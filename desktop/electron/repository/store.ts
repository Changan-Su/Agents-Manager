import { app } from 'electron'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  repoDelete,
  repoFind,
  repoInsert,
  repoList,
  repoUpdate,
} from '../db/queries'
import type {
  AgentKind,
  Asset,
  RepositoryItem,
  RepositoryKind,
} from '../../../shared/types'
import { findAssetById, listMcpServers } from '../db/queries'

function rootDir(): string {
  const dir = join(app.getPath('userData'), 'repository')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function itemDir(item: { kind: string; id: string }): string {
  return join(rootDir(), item.kind, item.id)
}

function listFilesRel(absRoot: string): Array<{ relPath: string; sizeBytes: number }> {
  const out: Array<{ relPath: string; sizeBytes: number }> = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else if (s.isFile()) {
        out.push({ relPath: relative(absRoot, p), sizeBytes: s.size })
      }
    }
  }
  if (existsSync(absRoot)) walk(absRoot)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export function listRepository(kind?: RepositoryKind): RepositoryItem[] {
  return repoList(kind)
}

export function getRepository(id: string): RepositoryItem | null {
  return repoFind(id)
}

export function deleteRepository(id: string): boolean {
  const item = repoFind(id)
  if (!item) return false
  if (existsSync(item.storagePath)) {
    rmSync(item.storagePath, { recursive: true, force: true })
  }
  return repoDelete(id)
}

export interface CreateInput {
  kind: RepositoryKind
  name: string
  version?: string
  description?: string
  files: Array<{ relPath: string; content: string }>
  primaryFile?: string
  mcpServerEntry?: RepositoryItem['manifest']['mcpServerEntry']
}

export function createRepository(input: CreateInput): RepositoryItem {
  const id = randomUUID()
  const now = Date.now()
  const dir = itemDir({ kind: input.kind, id })
  mkdirSync(dir, { recursive: true })
  for (const f of input.files) {
    const target = join(dir, f.relPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, f.content, 'utf-8')
  }
  const item: RepositoryItem = {
    id,
    kind: input.kind,
    name: input.name,
    version: input.version,
    description: input.description,
    storagePath: dir,
    manifest: {
      files: listFilesRel(dir),
      primaryFile: input.primaryFile,
      mcpServerEntry: input.mcpServerEntry,
    },
    deployedTo: [],
    createdAt: now,
    updatedAt: now,
  }
  repoInsert(item)
  return item
}

export interface UpdateInput {
  id: string
  name?: string
  version?: string
  description?: string
  files?: Array<{ relPath: string; content: string }>
  primaryFile?: string
  mcpServerEntry?: RepositoryItem['manifest']['mcpServerEntry']
}

export function updateRepository(input: UpdateInput): RepositoryItem {
  const existing = repoFind(input.id)
  if (!existing) throw new Error(`repository item not found: ${input.id}`)

  if (input.files) {
    // Replace contents wholesale — simpler than diffing for v1.
    if (existsSync(existing.storagePath)) {
      rmSync(existing.storagePath, { recursive: true, force: true })
    }
    mkdirSync(existing.storagePath, { recursive: true })
    for (const f of input.files) {
      const target = join(existing.storagePath, f.relPath)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, f.content, 'utf-8')
    }
  }

  const updated: RepositoryItem = {
    ...existing,
    name: input.name ?? existing.name,
    version: input.version ?? existing.version,
    description: input.description ?? existing.description,
    manifest: {
      files: listFilesRel(existing.storagePath),
      primaryFile: input.primaryFile ?? existing.manifest.primaryFile,
      mcpServerEntry: input.mcpServerEntry ?? existing.manifest.mcpServerEntry,
    },
    updatedAt: Date.now(),
  }
  repoUpdate(updated)
  return updated
}

/**
 * Read the contents of every file in a repository item, so the renderer can
 * display + edit. The renderer is responsible for keeping these in sync.
 */
export function readRepository(id: string): {
  item: RepositoryItem
  files: Array<{ relPath: string; content: string }>
} {
  const item = repoFind(id)
  if (!item) throw new Error(`repository item not found: ${id}`)
  const files: Array<{ relPath: string; content: string }> = []
  for (const f of item.manifest.files) {
    const abs = join(item.storagePath, f.relPath)
    if (!existsSync(abs)) continue
    files.push({ relPath: f.relPath, content: readFileSync(abs, 'utf-8') })
  }
  return { item, files }
}

/**
 * Import a Claude Code skill / command / hook / mcp from the existing
 * scanner index into the repository. We copy the source files (skill dir or
 * single file) into our managed storage so the user can edit a clean copy
 * without disturbing the live install.
 */
export function importFromAsset(assetId: string): RepositoryItem {
  const asset = findAssetById(assetId)
  if (!asset) throw new Error(`asset not found: ${assetId}`)
  const kind = repositoryKindFromAsset(asset)

  const id = randomUUID()
  const dir = itemDir({ kind, id })
  mkdirSync(dir, { recursive: true })

  let primaryFile: string | undefined
  if (asset.kind === 'skill') {
    const sourceDir = (asset.parsed as { dir?: string }).dir ?? dirname(asset.sourcePath)
    cpSync(sourceDir, dir, { recursive: true })
    primaryFile = 'SKILL.md'
  } else {
    const target = join(dir, primaryFileForAsset(asset))
    cpSync(asset.sourcePath, target)
    primaryFile = primaryFileForAsset(asset)
  }

  const now = Date.now()
  const item: RepositoryItem = {
    id,
    kind,
    name: asset.name,
    version: undefined,
    description: asset.description,
    storagePath: dir,
    manifest: {
      files: listFilesRel(dir),
      primaryFile,
    },
    deployedTo: [],
    createdAt: now,
    updatedAt: now,
  }
  repoInsert(item)
  return item
}

export function importMcpServer(agentKind: AgentKind, mcpName: string): RepositoryItem {
  const all = listMcpServers(agentKind)
  const found = all.find((m) => m.name === mcpName)
  if (!found) throw new Error(`mcp server not found: ${agentKind}/${mcpName}`)

  const id = randomUUID()
  const dir = itemDir({ kind: 'mcp_server', id })
  mkdirSync(dir, { recursive: true })

  // Persist a single .json so users can edit easily.
  const entry = {
    name: found.name,
    command: found.command,
    args: found.args,
    env: found.env,
    type: found.type,
    url: found.url,
  }
  const fileName = `${found.name}.json`
  writeFileSync(join(dir, fileName), JSON.stringify(entry, null, 2) + '\n', 'utf-8')

  const now = Date.now()
  const item: RepositoryItem = {
    id,
    kind: 'mcp_server',
    name: found.name,
    description: found.command ?? found.url,
    storagePath: dir,
    manifest: {
      files: listFilesRel(dir),
      primaryFile: fileName,
      mcpServerEntry: entry,
    },
    deployedTo: [],
    createdAt: now,
    updatedAt: now,
  }
  repoInsert(item)
  return item
}

export function recordDeployment(
  id: string,
  deployments: RepositoryItem['deployedTo'],
): void {
  const item = repoFind(id)
  if (!item) return
  const updated: RepositoryItem = {
    ...item,
    deployedTo: [...item.deployedTo, ...deployments],
    updatedAt: Date.now(),
  }
  repoUpdate(updated)
}

export function clearDeployment(id: string, deploymentId: string): void {
  const item = repoFind(id)
  if (!item) return
  const updated: RepositoryItem = {
    ...item,
    deployedTo: item.deployedTo.filter((d) => d.deploymentId !== deploymentId),
    updatedAt: Date.now(),
  }
  repoUpdate(updated)
}

function repositoryKindFromAsset(asset: Asset): RepositoryKind {
  switch (asset.kind) {
    case 'skill':
      return 'skill'
    case 'command':
      return 'command'
    case 'hook':
      return 'hook'
    case 'agent':
      return 'agent_def'
    default:
      throw new Error(`cannot import asset kind=${asset.kind} into repository`)
  }
}

function primaryFileForAsset(asset: Asset): string {
  // Mirror the source-file basename so the deploy step can drop it back where
  // it belongs without renaming.
  const m = asset.sourcePath.match(/[^/\\]+$/)
  return m ? m[0] : 'content'
}
