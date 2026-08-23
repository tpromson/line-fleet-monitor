const DEFAULT_TOKEN_URL = 'https://cvp1.moph.go.th/token'
const DEFAULT_ALERT_BASE_URL = 'https://morpromt2c.moph.go.th'
const FETCH_TIMEOUT_MS = 30_000

type JsonObject = Record<string, unknown>

type MophAlertConfig = {
  enabled: boolean
  tokenUrl: string
  alertBaseUrl: string
  user: string
  passwordHash: string
  hospitalCode: string
  cids: string[]
}

export type MophAlertResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

function splitList(value: string | undefined): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? []
}

export function getMophAlertConfig(): MophAlertConfig {
  return {
    enabled: process.env.MOPH_ALERT_ENABLED === 'true',
    tokenUrl: process.env.MOPH_ALERT_TOKEN_URL || DEFAULT_TOKEN_URL,
    alertBaseUrl: process.env.MOPH_ALERT_BASE_URL || DEFAULT_ALERT_BASE_URL,
    user: process.env.MOPH_ALERT_USER || '',
    passwordHash: process.env.MOPH_ALERT_PASSWORD_HASH || '',
    hospitalCode: process.env.MOPH_ALERT_HOSPITAL_CODE || '',
    cids: splitList(process.env.MOPH_ALERT_CIDS),
  }
}

function withTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout))
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function findToken(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim().length > 20) return value.trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findToken(item, depth + 1)
      if (token) return token
    }
    return null
  }
  if (typeof value !== 'object') return null

  const object = value as JsonObject
  for (const key of ['access_token', 'accessToken', 'token', 'jwt']) {
    const candidate = object[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  for (const child of Object.values(object)) {
    const token = findToken(child, depth + 1)
    if (token) return token
  }
  return null
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'TIMEOUT'
  if (error instanceof Error) return error.message
  return 'UNKNOWN_ERROR'
}

async function getAccessToken(config: MophAlertConfig): Promise<string> {
  const params = new URLSearchParams({
    Action: 'get_moph_access_token',
    user: config.user,
    password_hash: config.passwordHash,
    hospital_code: config.hospitalCode,
  })

  const response = await withTimeout(`${config.tokenUrl}?${params.toString()}`, { method: 'GET' })
  const body = await parseResponse(response)
  if (!response.ok) throw new Error(`TOKEN_HTTP_${response.status}`)

  const token = findToken(body)
  if (!token) throw new Error('TOKEN_NOT_FOUND_IN_RESPONSE')
  return token
}

export async function sendMophAlert(message: string): Promise<MophAlertResult> {
  const config = getMophAlertConfig()

  if (!config.enabled) return { status: 'skipped', reason: 'MOPH_ALERT_ENABLED is not true' }
  if (!config.user || !config.passwordHash || !config.hospitalCode) {
    return { status: 'skipped', reason: 'MOPH Alert credentials are incomplete' }
  }
  if (config.cids.length === 0) {
    return { status: 'skipped', reason: 'MOPH_ALERT_CIDS is empty' }
  }

  try {
    const token = await getAccessToken(config)
    const response = await withTimeout(`${config.alertBaseUrl}/api/v2/send-message/send-now`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        datas: config.cids,
        messages: [{ type: 'text', text: message }],
      }),
    })

    if (!response.ok) {
      return { status: 'failed', reason: `SEND_HTTP_${response.status}` }
    }

    console.log(`[moph-alert] Sent notification to ${config.cids.length} recipient(s)`)
    return { status: 'sent' }
  } catch (error) {
    const reason = errorReason(error)
    console.error('[moph-alert] Send failed:', reason)
    return { status: 'failed', reason }
  }
}
