// Renderer-side mirror of the BackupRow shape exposed by preload.ts.
// We keep this here so renderer code doesn't reach into the preload module
// directly (which can confuse vite's renderer build context).

export interface BackupRow {
  id: string
  assetId: string
  beforeHash: string
  afterHash: string
  backupPath: string
  editedAt: number
}
