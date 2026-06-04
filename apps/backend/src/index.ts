import { buildApp } from './app.js'
import cron from 'node-cron'
import { collectAllQuotas } from './collector.js'
import { checkAlerts } from './alert-engine.js'
import { checkAllWebhooks } from './webhook-monitor.js'
import { detectOfflineDevices } from './iotcenter-health.js'

const PORT = process.env.PORT || 3001
const app = buildApp()

let collectionRunning = false
let offlineCheckRunning = false

async function runCollection() {
  if (collectionRunning) { console.log('[cron] Skipped - previous collection still running'); return }
  collectionRunning = true
  try {
    await collectAllQuotas()
    await checkAllWebhooks()
    await checkAlerts()
    await detectOfflineDevices()
  } catch (err) {
    console.error('[cron] Collection error:', err)
  } finally {
    collectionRunning = false
  }
}

cron.schedule('0 0,6,12,18 * * *', () => {
  console.log('[cron] Scheduled collection triggered')
  runCollection().catch((err) => console.error('[cron] runCollection unhandled:', err))
})

cron.schedule('*/5 * * * *', () => {
  if (offlineCheckRunning) return
  offlineCheckRunning = true
  detectOfflineDevices()
    .catch((err) => console.error('[cron] detectOfflineDevices unhandled:', err))
    .finally(() => { offlineCheckRunning = false })
})

app.listen(PORT, () => {
  console.log(`Backend service running on port ${PORT}`)
  console.log('[cron] Schedule: 00:00, 06:00, 12:00, 18:00')

  runCollection().catch((err) => console.error('[startup] runCollection error:', err))
})
