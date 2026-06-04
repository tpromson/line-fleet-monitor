import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendAlertEmail(to: string[], subject: string, text: string) {
  if (to.length === 0) return

  const from = process.env.ALERT_EMAIL_FROM
  if (!from) {
    console.error('ALERT_EMAIL_FROM not set, cannot send email')
    return
  }

  try {
    await resend.emails.send({
      from,
      to,
      subject,
      text,
    })
    console.log(`Email sent: ${subject}`)
  } catch (err) {
    console.error('Failed to send email:', err)
  }
}
