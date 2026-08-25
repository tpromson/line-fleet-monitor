const DEFAULT_NOTIFY_URL = 'https://morpromt2f.moph.go.th/api/notify/send'
const FETCH_TIMEOUT_MS = 10_000

type MophNotifyConfig = {
  enabled: boolean
  url: string
  clientKey: string
  secretKey: string
  organizationId: string
}

export type MophNotifyResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

export function getMophNotifyConfig(): MophNotifyConfig {
  return {
    enabled: process.env.MOPH_NOTIFY_ENABLED === 'true',
    url: process.env.MOPH_NOTIFY_URL || DEFAULT_NOTIFY_URL,
    clientKey: process.env.MOPH_NOTIFY_CLIENT_KEY || '',
    secretKey: process.env.MOPH_NOTIFY_SECRET_KEY || '',
    organizationId: process.env.MOPH_NOTIFY_ORGANIZATION_ID || '',
  }
}

async function postNotify(config: MophNotifyConfig, message: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    return await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-key': config.clientKey,
        'secret-key': config.secretKey,
      },
      body: JSON.stringify({
        messages: [{ type: 'text', text: message }],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'TIMEOUT'
  if (error instanceof Error) return error.message
  return 'UNKNOWN_ERROR'
}

export async function sendMophNotify(message: string, organizationId?: string): Promise<MophNotifyResult> {
  const config = getMophNotifyConfig()

  if (!config.enabled) return { status: 'skipped', reason: 'MOPH_NOTIFY_ENABLED is not true' }
  if (config.organizationId && organizationId !== config.organizationId) {
    return { status: 'skipped', reason: 'Organization is not allowed for MOPH Notify' }
  }
  if (!config.clientKey || !config.secretKey) {
    return { status: 'skipped', reason: 'MOPH Notify credentials are incomplete' }
  }

  try {
    const response = await postNotify(config, message)
    if (!response.ok) return { status: 'failed', reason: `HTTP_${response.status}` }

    console.log('[moph-notify] Sent notification')
    return { status: 'sent' }
  } catch (error) {
    const reason = errorReason(error)
    console.error('[moph-notify] Send failed:', reason)
    return { status: 'failed', reason }
  }
}
