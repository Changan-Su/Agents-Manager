import type { Readable } from 'node:stream'

export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  stream?(key: string): Readable
}

export { LocalFsStorage } from './localFs'
