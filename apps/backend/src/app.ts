import express from 'express'
import type { Express } from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { collectAllQuotas } from './collector.js'
import { checkAlerts } from './alert-engine.js'
import { checkAllWebhooks } from './webhook-monitor.js'
import { testChannelWebhook } from './lib/line-api.js'
import { getAuthorizedChannelAccessToken, requireAuth, requireSuperAdmin } from './lib/auth.js'
import { supabase } from './lib/supabase.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return value
}

export function buildApp(): Express {
  const allowedOrigin = requireEnv('CORS_ORIGIN')

  const app = express()

  app.use(helmet())

  app.use(express.json({ limit: '100kb' }))

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX) || 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  })

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', allowedOrigin)
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.post('/api/sync', apiLimiter, async (req, res) => {
    const auth = await requireSuperAdmin(req, res)
    if (!auth) return

    console.log('[api] Manual sync triggered')
    res.json({ status: 'started' })

    await collectAllQuotas()
    await checkAllWebhooks()
    await checkAlerts()
  })

  app.get('/api/channels/:id/webhook-test', apiLimiter, async (req, res) => {
    const auth = await requireAuth(req, res)
    if (!auth) return

    const { id } = req.params
    const channel = await getAuthorizedChannelAccessToken(id as string, auth)

    if (!channel.accessToken) {
      res.status(channel.status ?? 404).json({ error: channel.error ?? 'Channel not found' })
      return
    }

    const status = await testChannelWebhook(channel.accessToken)
    res.json({ status })
  })

  app.get('/api/users/lookup', apiLimiter, async (req, res) => {
    const auth = await requireSuperAdmin(req, res)
    if (!auth) return

    const email = req.query.email as string
    const id = req.query.id as string
    if (!email && !id) {
      res.status(400).json({ error: 'email or id query param required' })
      return
    }

    const { data, error } = await supabase.auth.admin.listUsers()
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    const user = data.users.find((u) => (id ? u.id === id : u.email === email))
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({ id: user.id, email: user.email })
  })

  return app
}
