import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendAlertEmail(to: string[], subject: string, text: string) {
  try {
    await resend.emails.send({
      from: process.env.ALERT_EMAIL_FROM!,
      to,
      subject,
      text,
    })
    console.log(`Email sent: ${subject}`)
  } catch (err) {
    console.error('Failed to send email:', err)
  }
}
