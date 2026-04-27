import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/migrate'

export interface UserRow {
  id: string
  email: string
  password_hash: string
  role: string
  created_at: number
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const db = getDb()
  const row = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as
    | UserRow
    | undefined
  return row ?? null
}

export function findUserById(id: string): UserRow | null {
  const db = getDb()
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined
  return row ?? null
}

export function countUsers(): number {
  const db = getDb()
  const row = db.prepare(`SELECT COUNT(*) as n FROM users`).get() as { n: number }
  return row.n
}

export async function createUser(
  email: string,
  password: string,
  role: 'user' | 'admin' = 'user',
): Promise<UserRow> {
  if (!email || !email.includes('@')) throw new Error('invalid email')
  if (!password || password.length < 8) throw new Error('password too short (min 8 chars)')

  const hash = await bcrypt.hash(password, 12)
  const id = randomUUID()
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email.toLowerCase(), hash, role, now)
  return { id, email: email.toLowerCase(), password_hash: hash, role, created_at: now }
}

export async function verifyPassword(user: UserRow, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.password_hash)
}
