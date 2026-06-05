interface QuotaResponse {
  used: number
  remaining: number
  limit: number
  error?: string
}

const FETCH_TIMEOUT_MS = 30000
const RETRY_ATTEMPTS = parseInt(process.env.RETRY_ATTEMPTS || '3', 10)
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '1000', 10)

function fetchWithTimeout(url: string, options: RequestInit = {}): ReturnType<typeof fetch> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout))
}

async function fetchWithRetry(url: string, options: RequestInit, attempt = 1): Promise<Response> {
  const res = await fetchWithTimeout(url, options)
  if (res.ok || res.status === 401 || (res.status >= 400 && res.status < 500)) {
    return res
  }
  if (attempt >= RETRY_ATTEMPTS) return res
  const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1)
  await sleep(delay)
  return fetchWithRetry(url, options, attempt + 1)
}

export async function fetchChannelQuota(accessToken: string, quotaLimit: number): Promise<QuotaResponse> {
  try {
    const res = await fetchWithRetry('https://api.line.me/v2/bot/message/quota/consumption', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      if (res.status === 401) return { used: 0, remaining: 0, limit: quotaLimit, error: 'UNAUTHORIZED' }
      if (res.status === 429) return { used: 0, remaining: 0, limit: quotaLimit, error: 'RATE_LIMITED' }
      return { used: 0, remaining: 0, limit: quotaLimit, error: `HTTP_${res.status}` }
    }

    const data = await res.json()
    const used = data.totalUsage ?? 0
    const remaining = quotaLimit - used

    return { used, remaining, limit: quotaLimit }
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR'
    return { used: 0, remaining: 0, limit: quotaLimit, error: message }
  }
}

export async function testChannelWebhook(accessToken: string): Promise<'online' | 'offline' | 'unknown'> {
  try {
    const res = await fetchWithTimeout('https://api.line.me/v2/bot/channel/webhook/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      return res.status === 401 ? 'unknown' : 'offline'
    }
    return 'online'
  } catch {
    return 'unknown'
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { sleep }
