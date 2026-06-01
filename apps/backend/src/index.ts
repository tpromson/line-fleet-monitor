import express from 'express'
import cron from 'node-cron'
import { collectAllQuotas } from './collector.js'
import { checkAlerts } from './alert-engine.js'
import { checkAllWebhooks } from './webhook-monitor.js'

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
