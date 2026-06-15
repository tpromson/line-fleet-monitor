import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const from = process.env.ALERT_EMAIL_FROM!
const to = process.env.ALERT_EMAIL_TO!.split(',').map((e) => e.trim()).filter(Boolean)

console.log(`[debug] from: ${from}`)
console.log(`[debug] to: ${to.join(', ')}`)

const { data, error } = await resend.emails.send({
  from,
  to,
  subject: '[LINE Fleet] DEBUG test',
  text: 'Debug test from backend test script',
})

console.log('[debug] data:', JSON.stringify(data, null, 2))
console.log('[debug] error:', JSON.stringify(error, null, 2))

if (error) {
  console.error(`[debug] FAILED: ${error.name} — ${error.message}`)
  process.exit(1)
}

console.log(`[debug] OK — message id: ${data?.id}`)
process.exit(0)
