import express from 'express'
import type { Express } from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import * as Sentry from '@sentry/node'
import { collectAllQuotas } from './collector.js'
import { checkAlerts } from './alert-engine.js'
import { checkAllWebhooks } from './webhook-monitor.js'
import { testChannelWebhook } from './lib/line-api.js'
import { getAuthorizedChannelAccessToken, requireAuth, requireSuperAdmin } from './lib/auth.js'
import { registerIotcenterRoutes } from './routes/iotcenter.js'
import { supabase } from './lib/supabase.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return value
}

export function buildApp(): Express {
  const allowedOrigins = new Set(
    requireEnv('CORS_ORIGIN')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  )

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
    const origin = req.headers.origin
    if (origin && allowedOrigins.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin)
      res.header('Vary', 'Origin')
    }
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

    try {
      await collectAllQuotas()
      await checkAllWebhooks()
      await checkAlerts()
    } catch (err) {
      console.error('[api] Manual sync failed:', err)
      Sentry.captureException(err, { tags: { context: 'manual-sync' } })
    }
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

    if (id) {
      const { data, error } = await supabase.auth.admin.getUserById(id)
      if (error || !data.user) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      res.json({ id: data.user.id, email: data.user.email })
      return
    }

    const perPage = 50
    let page = 1
    let user: { id: string; email: string } | null = null
    while (page <= 20) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
      if (error) {
        res.status(500).json({ error: error.message })
        return
      }
      const found = data.users.find((u) => u.email === email)
      if (found) user = { id: found.id, email: found.email ?? '' }
      if (user || data.users.length < perPage) break
      page++
    }

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({ id: user.id, email: user.email })
  })

  app.post('/api/users/lookup-batch', apiLimiter, async (req, res) => {
    const auth = await requireSuperAdmin(req, res)
    if (!auth) return

    const ids = (req.body?.ids as string[] | undefined)?.filter((s) => typeof s === 'string' && s.length > 0)
    if (!ids || ids.length === 0) {
      res.status(400).json({ error: 'ids (string[]) required' })
      return
    }
    if (ids.length > 200) {
      res.status(400).json({ error: 'max 200 ids per request' })
      return
    }

    const perPage = 50
    const wanted = new Set(ids)
    const found: Record<string, { id: string; email: string }> = {}
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
      if (error) {
        res.status(500).json({ error: error.message })
        return
      }
      for (const u of data.users) {
        if (wanted.has(u.id)) found[u.id] = { id: u.id, email: u.email ?? '' }
        if (Object.keys(found).length === wanted.size) break
      }
      if (Object.keys(found).length === wanted.size || data.users.length < perPage) break
    }

    res.json({ users: found })
  })

  registerIotcenterRoutes(app)

  return app
}
