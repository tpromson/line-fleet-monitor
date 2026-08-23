export function validateEnv(): void {
  const warnings: string[] = []

  if (!process.env.SUPABASE_URL) warnings.push('SUPABASE_URL is not set')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) warnings.push('SUPABASE_SERVICE_ROLE_KEY is not set')
  if (!process.env.CORS_ORIGIN) warnings.push('CORS_ORIGIN is not set (required by buildApp)')

  if (process.env.RESEND_API_KEY) {
    if (!process.env.ALERT_EMAIL_FROM) warnings.push('ALERT_EMAIL_FROM is not set (RESEND_API_KEY is set)')
    if (!process.env.ALERT_EMAIL_TO) warnings.push('ALERT_EMAIL_TO is not set (RESEND_API_KEY is set) — alerts will not be delivered')
  }

  if (process.env.ALERT_EMAIL_TO && !process.env.RESEND_API_KEY) {
    warnings.push('ALERT_EMAIL_TO is set but RESEND_API_KEY is missing — alerts will fail to send')
  }

  const mophAlertFields = [
    'MOPH_ALERT_USER',
    'MOPH_ALERT_PASSWORD_HASH',
    'MOPH_ALERT_HOSPITAL_CODE',
    'MOPH_ALERT_CIDS',
  ]
  const hasMophAlertSettings = mophAlertFields.some((name) => Boolean(process.env[name]))
  if (hasMophAlertSettings && process.env.MOPH_ALERT_ENABLED !== 'true') {
    warnings.push('MOPH Alert settings are present but MOPH_ALERT_ENABLED is not true — sending is disabled')
  }
  if (process.env.MOPH_ALERT_ENABLED === 'true') {
    for (const name of mophAlertFields) {
      if (!process.env[name]) warnings.push(`${name} is not set — MOPH Alert sending will be skipped`)
    }
  }

  const mophNotifyFields = ['MOPH_NOTIFY_CLIENT_KEY', 'MOPH_NOTIFY_SECRET_KEY']
  const hasMophNotifySettings = mophNotifyFields.some((name) => Boolean(process.env[name]))
  if (hasMophNotifySettings && process.env.MOPH_NOTIFY_ENABLED !== 'true') {
    warnings.push('MOPH Notify settings are present but MOPH_NOTIFY_ENABLED is not true — sending is disabled')
  }
  if (process.env.MOPH_NOTIFY_ENABLED === 'true') {
    for (const name of mophNotifyFields) {
      if (!process.env[name]) warnings.push(`${name} is not set — MOPH Notify sending will be skipped`)
    }
    if (!process.env.MOPH_SUMMARY_API_KEY) {
      warnings.push('MOPH_SUMMARY_API_KEY is not set — sensor summary endpoint is disabled')
    }
  }

  for (const w of warnings) console.warn(`[env] WARNING: ${w}`)
}
