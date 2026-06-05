import { buildApp } from './app.js'
import cron from 'node-cron'
import * as Sentry from '@sentry/node'
import { collectAllQuotas } from './collector.js'
import { checkAlerts } from './alert-engine.js'
import { checkAllWebhooks } from './webhook-monitor.js'
import { detectOfflineDevices } from './iotcenter-health.js'
import { validateEnv } from './lib/env.js'

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN })
}

validateEnv()

const PORT = process.env.PORT || 3001
const app = buildApp()

let collectionRunning = false
let offlineCheckRunning = false
let collectionFailureCount = 0
const ALERT_AFTER_FAILURES = 3

async function runCollection() {
  if (collectionRunning) { console.log('[cron] Skipped - previous collection still running'); return }
  collectionRunning = true
  try {
    await collectAllQuotas()
    await checkAllWebhooks()
    await checkAlerts()
    collectionFailureCount = 0
  } catch (err) {
    collectionFailureCount++
    console.error(`[cron] Collection error (failure #${collectionFailureCount}):`, err)
    Sentry.captureException(err, { tags: { context: 'cron-collection' } })
    if (collectionFailureCount >= ALERT_AFTER_FAILURES) {
      console.error(`[cron] CRITICAL: ${collectionFailureCount} consecutive collection failures`)
    }
  } finally {
    collectionRunning = false
  }
}

cron.schedule('0 0,6,12,18 * * *', () => {
  console.log('[cron] Scheduled collection triggered')
  runCollection().catch((err) => {
    console.error('[cron] runCollection unhandled:', err)
    Sentry.captureException(err, { tags: { context: 'cron-runCollection' } })
  })
})

cron.schedule('*/5 * * * *', () => {
  if (offlineCheckRunning) return
  offlineCheckRunning = true
  detectOfflineDevices()
    .catch((err) => {
      console.error('[cron] detectOfflineDevices unhandled:', err)
      Sentry.captureException(err, { tags: { context: 'cron-offline-check' } })
    })
    .finally(() => { offlineCheckRunning = false })
})

const server = app.listen(PORT, () => {
  console.log(`Backend service running on port ${PORT}`)
  console.log('[cron] Schedule: 00:00, 06:00, 12:00, 18:00')

  runCollection().catch((err) => console.error('[startup] runCollection error:', err))
})

let shuttingDown = false
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] ${signal} received, draining (max 25s)...`)

  server.close(() => console.log('[shutdown] HTTP server closed'))

  const deadline = setTimeout(() => {
    console.error('[shutdown] Timeout - forcing exit')
    process.exit(1)
  }, 25_000)

  while (collectionRunning || offlineCheckRunning) {
    await new Promise((r) => setTimeout(r, 500))
  }

  clearTimeout(deadline)
  console.log('[shutdown] All in-flight work complete')
  process.exit(0)
}

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM') })
process.on('SIGINT', () => { gracefulShutdown('SIGINT') })
