import {
  promises as fs,
  createReadStream,
  existsSync,
  mkdirSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import type { StorageDriver } from './index'

export class LocalFsStorage implements StorageDriver {
  private readonly root: string
  constructor(root: string) {
    this.root = resolve(root)
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true })
  }

  // Resolve `key` to an absolute path inside `root`. Throws on traversal attempts.
  private resolveKey(key: string): string {
    if (!key || key.includes('..')) throw new Error('invalid storage key')
    const target = resolve(this.root, key)
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('storage key escapes root')
    }
    return target
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.resolveKey(key)
    await fs.mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
    await fs.writeFile(tmp, data, { mode: 0o600 })
    await fs.rename(tmp, path)
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKey(key))
  }

  async delete(key: string): Promise<void> {
    const path = this.resolveKey(key)
    if (existsSync(path)) await fs.unlink(path)
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolveKey(key))
  }

  stream(key: string): Readable {
    return createReadStream(this.resolveKey(key))
  }
}
