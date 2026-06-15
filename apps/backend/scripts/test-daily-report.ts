import { sendDailyReport } from '../src/daily-report.js'
import { validateEnv } from '../src/lib/env.js'

validateEnv()

const missing: string[] = []
if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY')
if (!process.env.ALERT_EMAIL_FROM) missing.push('ALERT_EMAIL_FROM')
if (!process.env.ALERT_EMAIL_TO) missing.push('ALERT_EMAIL_TO')

if (missing.length > 0) {
  console.error(`[test] Missing env: ${missing.join(', ')}`)
  console.error('[test] Add them to apps/backend/.env and re-run with --env-file=.env')
  process.exit(1)
}

const recipients = process.env.ALERT_EMAIL_TO!.split(',').map((e) => e.trim()).filter(Boolean)
console.log(`[test] Recipients: ${recipients.join(', ')}`)
console.log(`[test] From: ${process.env.ALERT_EMAIL_FROM}`)
console.log('[test] Triggering sendDailyReport()...')

const start = Date.now()
sendDailyReport()
  .then(() => {
    console.log(`[test] OK in ${Date.now() - start}ms`)
    process.exit(0)
  })
  .catch((err) => {
    console.error('[test] FAILED:', err)
    process.exit(1)
  })
