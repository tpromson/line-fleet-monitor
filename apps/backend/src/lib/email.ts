import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendAlertEmail(
  to: string[],
  subject: string,
  text: string,
  html?: string
) {
  if (to.length === 0) return

  const from = process.env.ALERT_EMAIL_FROM
  if (!from) {
    console.error('ALERT_EMAIL_FROM not set, cannot send email')
    return
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    })
    if (error) {
      console.error(`Failed to send email "${subject}":`, error)
      return
    }
    console.log(`Email sent: ${subject} (id: ${data?.id ?? 'unknown'})`)
  } catch (err) {
    console.error(`Failed to send email "${subject}":`, err)
  }
}
