import express from 'express'
import cron from 'node-cron'
import { collectAllQuotas } from './collector.js'
import { checkAlerts } from './alert-engine.js'
import { checkAllWebhooks } from './webhook-monitor.js'
import { testChannelWebhook } from './lib/line-api.js'
import { getAuthorizedChannelAccessToken, requireAuth, requireSuperAdmin } from './lib/auth.js'
import { supabase } from './lib/supabase.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(express.json())
app.use((req, res, next) => {
  const allowedOrigin = process.env.CORS_ORIGIN ?? '*'
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

app.post('/api/sync', async (req, res) => {
  const auth = await requireSuperAdmin(req, res)
  if (!auth) return

  console.log('[api] Manual sync triggered')
  res.json({ status: 'started' })

  await collectAllQuotas()
  await checkAllWebhooks()
  await checkAlerts()
})

app.get('/api/channels/:id/webhook-test', async (req, res) => {
  const auth = await requireAuth(req, res)
  if (!auth) return

  const { id } = req.params
  const channel = await getAuthorizedChannelAccessToken(id, auth)

  if (!channel.accessToken) {
    res.status(channel.status ?? 404).json({ error: channel.error ?? 'Channel not found' })
    return
  }

  const status = await testChannelWebhook(channel.accessToken)
  res.json({ status })
})

app.get('/api/users/lookup', async (req, res) => {
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

async function runCollection() {
  await collectAllQuotas()
  await checkAllWebhooks()
  await checkAlerts()
}

cron.schedule('0 0,6,12,18 * * *', () => {
  console.log('[cron] Scheduled collection triggered')
  runCollection()
})

app.listen(PORT, () => {
  console.log(`Backend service running on port ${PORT}`)
  console.log('[cron] Schedule: 00:00, 06:00, 12:00, 18:00')

  runCollection()
})
