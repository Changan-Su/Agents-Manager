import { createHash } from 'node:crypto'
import type { Asset, AgentKind, AssetKind } from '../../../shared/types'

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function makeAssetId(
  agentKind: AgentKind,
  assetKind: AssetKind,
  identifier: string,
): string {
  return `${agentKind}:${assetKind}:${identifier}`
}

export function buildAsset(params: {
  agentKind: AgentKind
  kind: AssetKind
  name: string
  description?: string
  model?: string
  tools?: string[]
  mode?: 'primary' | 'subagent'
  sourcePath: string
  raw: string
  parsed: Record<string, unknown>
}): Asset {
  const id = makeAssetId(params.agentKind, params.kind, params.sourcePath)
  return {
    id,
    agentKind: params.agentKind,
    kind: params.kind,
    name: params.name,
    description: params.description,
    model: params.model,
    tools: params.tools,
    mode: params.mode,
    sourcePath: params.sourcePath,
    rawHash: sha256(params.raw),
    parsed: params.parsed,
  }
}

export function asStringArray(input: unknown): string[] | undefined {
  if (!input) return undefined
  if (Array.isArray(input)) {
    return input.filter((v): v is string => typeof v === 'string')
  }
  if (typeof input === 'string') {
    return input
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return undefined
}
