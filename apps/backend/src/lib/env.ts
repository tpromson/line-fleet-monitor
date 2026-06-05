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

  for (const w of warnings) console.warn(`[env] WARNING: ${w}`)
}
