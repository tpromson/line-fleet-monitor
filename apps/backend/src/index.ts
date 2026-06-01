import express from 'express'
import cron from 'node-cron'
import { collectAllQuotas } from './collector.js'
import { checkAlerts } from './alert-engine.js'
import { checkAllWebhooks } from './webhook-monitor.js'
import { supabase } from './lib/supabase.js'
import { testChannelWebhook } from './lib/line-api.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.post('/api/sync', async (_req, res) => {
  console.log('[api] Manual sync triggered')
  res.json({ status: 'started' })

  await collectAllQuotas()
  await checkAllWebhooks()
  await checkAlerts()
})

app.get('/api/channels/:id/webhook-test', async (req, res) => {
  const { id } = req.params

  const { data: channel } = await supabase
    .from('channels')
    .select('access_token')
    .eq('id', id)
    .single()

  if (!channel?.access_token) {
    res.status(404).json({ error: 'Channel not found' })
    return
  }

  const status = await testChannelWebhook(channel.access_token)
  res.json({ status })
})

app.get('/api/users/lookup', async (req, res) => {
  const email = req.query.email as string
  if (!email) {
    res.status(400).json({ error: 'email query param required' })
    return
  }

  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const user = data.users.find((u) => u.email === email)
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
