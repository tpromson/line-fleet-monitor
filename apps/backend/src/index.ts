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
