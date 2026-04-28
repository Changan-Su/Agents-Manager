import { ipcMain } from 'electron'
import {
  createRepository,
  deleteRepository,
  getRepository,
  importFromAsset,
  importMcpServer,
  listRepository,
  readRepository,
  updateRepository,
  type CreateInput,
  type UpdateInput,
} from '../repository/store'
import { deployItem, undeployItem } from '../repository/deploy'
import type { AgentKind, DeployTarget, RepositoryKind } from '../../../shared/types'

export function registerRepositoryIpc(): void {
  ipcMain.handle('repo:list', async (_evt, { kind }: { kind?: RepositoryKind } = {}) => {
    return listRepository(kind)
  })

  ipcMain.handle('repo:read', async (_evt, { id }: { id: string }) => {
    return readRepository(id)
  })

  ipcMain.handle('repo:get', async (_evt, { id }: { id: string }) => {
    return getRepository(id)
  })

  ipcMain.handle('repo:create', async (_evt, payload: CreateInput) => {
    return createRepository(payload)
  })

  ipcMain.handle('repo:update', async (_evt, payload: UpdateInput) => {
    return updateRepository(payload)
  })

  ipcMain.handle('repo:delete', async (_evt, { id }: { id: string }) => {
    return { ok: deleteRepository(id) }
  })

  ipcMain.handle(
    'repo:importFromAsset',
    async (_evt, { assetId }: { assetId: string }) => {
      return importFromAsset(assetId)
    },
  )

  ipcMain.handle(
    'repo:importMcp',
    async (
      _evt,
      { agentKind, name }: { agentKind: AgentKind; name: string },
    ) => {
      return importMcpServer(agentKind, name)
    },
  )

  ipcMain.handle(
    'repo:deploy',
    async (_evt, { id, targets }: { id: string; targets: DeployTarget[] }) => {
      return deployItem(id, targets)
    },
  )

  ipcMain.handle(
    'repo:undeploy',
    async (
      _evt,
      { id, deploymentId }: { id: string; deploymentId: string },
    ) => {
      return undeployItem(id, deploymentId)
    },
  )
}
