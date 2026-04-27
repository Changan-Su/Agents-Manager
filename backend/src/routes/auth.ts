import type { FastifyInstance } from 'fastify'
import {
  countUsers,
  createUser,
  findUserByEmail,
  findUserById,
  verifyPassword,
} from '../services/authService'
import type { AppConfig } from '../config'
import { requireAuth } from '../middleware/auth'

interface AuthBody {
  email?: string
  password?: string
}

export async function authRoutes(fastify: FastifyInstance, opts: { config: AppConfig }) {
  const { config } = opts

  fastify.post('/auth/register', async (req, reply) => {
    const { email, password } = (req.body ?? {}) as AuthBody
    if (!email || !password) {
      reply.code(400)
      return { error: 'email and password required' }
    }

    const isFirstUser = countUsers() === 0
    if (!isFirstUser && !config.allowRegistration) {
      reply.code(403)
      return { error: 'registration disabled — set ALLOW_REGISTRATION=true' }
    }

    if (await findUserByEmail(email)) {
      reply.code(409)
      return { error: 'email already registered' }
    }

    try {
      // First user becomes admin
      const user = await createUser(email, password, isFirstUser ? 'admin' : 'user')
      const token = await reply.jwtSign(
        { sub: user.id, email: user.email, role: user.role },
        { expiresIn: '30d' },
      )
      return { token, user: { id: user.id, email: user.email, role: user.role } }
    } catch (e) {
      reply.code(400)
      return { error: (e as Error).message }
    }
  })

  fastify.post('/auth/login', async (req, reply) => {
    const { email, password } = (req.body ?? {}) as AuthBody
    if (!email || !password) {
      reply.code(400)
      return { error: 'email and password required' }
    }
    const user = await findUserByEmail(email)
    if (!user || !(await verifyPassword(user, password))) {
      reply.code(401)
      return { error: 'invalid credentials' }
    }
    const token = await reply.jwtSign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '30d' },
    )
    return { token, user: { id: user.id, email: user.email, role: user.role } }
  })

  fastify.get('/auth/me', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) {
      reply.code(401)
      return { error: 'unauthorized' }
    }
    const user = findUserById(req.user.sub)
    if (!user) {
      reply.code(404)
      return { error: 'user not found' }
    }
    return { id: user.id, email: user.email, role: user.role }
  })
}
