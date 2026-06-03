import { buildApp } from './app.js'
import cron from 'node-cron'
import { collectAllQuotas } from './collector.js'
import { checkAlerts } from './alert-engine.js'
import { checkAllWebhooks } from './webhook-monitor.js'
import { detectOfflineDevices } from './iotcenter-health.js'

const PORT = process.env.PORT || 3001
const app = buildApp()

async function runCollection() {
  await collectAllQuotas()
  await checkAllWebhooks()
  await checkAlerts()
  await detectOfflineDevices()
}

cron.schedule('0 0,6,12,18 * * *', () => {
  console.log('[cron] Scheduled collection triggered')
  runCollection()
})

cron.schedule('*/5 * * * *', () => {
  detectOfflineDevices()
})

app.listen(PORT, () => {
  console.log(`Backend service running on port ${PORT}`)
  console.log('[cron] Schedule: 00:00, 06:00, 12:00, 18:00')

  runCollection()
})
