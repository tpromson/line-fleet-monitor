interface QuotaResponse {
  used: number
  remaining: number
  limit: number
  error?: string
}

const FETCH_TIMEOUT_MS = 30000

function fetchWithTimeout(url: string, options: RequestInit = {}): ReturnType<typeof fetch> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout))
}

export async function fetchChannelQuota(accessToken: string, quotaLimit: number): Promise<QuotaResponse> {
  try {
    const res = await fetchWithTimeout('https://api.line.me/v2/bot/message/quota/consumption', {
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
