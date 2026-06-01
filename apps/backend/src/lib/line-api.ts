interface QuotaResponse {
  used: number
  remaining: number
  limit: number
  error?: string
}

export async function fetchChannelQuota(accessToken: string, quotaLimit: number): Promise<QuotaResponse> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/quota/consumption', {
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
  } catch {
    return { used: 0, remaining: 0, limit: quotaLimit, error: 'NETWORK_ERROR' }
  }
}

export async function testChannelWebhook(accessToken: string): Promise<'online' | 'offline' | 'unknown'> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (res.ok) return 'online'
    return 'offline'
  } catch {
    return 'unknown'
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { sleep }
