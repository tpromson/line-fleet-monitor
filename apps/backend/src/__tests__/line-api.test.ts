import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { fetchChannelQuota, testChannelWebhook, sleep } from '../lib/line-api.js'

beforeEach(() => {
  mockFetch.mockReset()
})

describe('fetchChannelQuota', () => {
  const accessToken = 'test-token'
  const quotaLimit = 1000

  it('returns quota data on successful response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ totalUsage: 300 }),
    })

    const result = await fetchChannelQuota(accessToken, quotaLimit)

    expect(result).toEqual({ used: 300, remaining: 700, limit: quotaLimit })
  })

  it('returns UNAUTHORIZED error on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    })

    const result = await fetchChannelQuota(accessToken, quotaLimit)

    expect(result).toEqual({ used: 0, remaining: 0, limit: quotaLimit, error: 'UNAUTHORIZED' })
  })

  it('returns RATE_LIMITED error on 429', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    })

    const result = await fetchChannelQuota(accessToken, quotaLimit)

    expect(result).toEqual({ used: 0, remaining: 0, limit: quotaLimit, error: 'RATE_LIMITED' })
  })

  it('returns HTTP error on other status codes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const result = await fetchChannelQuota(accessToken, quotaLimit)

    expect(result).toEqual({ used: 0, remaining: 0, limit: quotaLimit, error: 'HTTP_500' })
  })

  it('returns NETWORK_ERROR on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await fetchChannelQuota(accessToken, quotaLimit)

    expect(result).toEqual({ used: 0, remaining: 0, limit: quotaLimit, error: 'NETWORK_ERROR' })
  })

  it('sends correct Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ totalUsage: 100 }),
    })

    await fetchChannelQuota(accessToken, quotaLimit)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/quota/consumption',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    )
  })

  it('handles missing totalUsage field defaulting to 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    const result = await fetchChannelQuota(accessToken, quotaLimit)

    expect(result).toEqual({ used: 0, remaining: quotaLimit, limit: quotaLimit })
  })
})

describe('testChannelWebhook', () => {
  const accessToken = 'test-token'

  it('returns "online" on successful response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
    })

    const result = await testChannelWebhook(accessToken)

    expect(result).toBe('online')
  })

  it('returns "offline" on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
    })

    const result = await testChannelWebhook(accessToken)

    expect(result).toBe('offline')
  })

  it('returns "unknown" on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await testChannelWebhook(accessToken)

    expect(result).toBe('unknown')
  })

  it('sends POST request with correct headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
    })

    await testChannelWebhook(accessToken)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/channel/webhook/test',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${accessToken}` },
        method: 'POST',
      }),
    )
  })
})

describe('sleep', () => {
  it('resolves after the given time', async () => {
    vi.useFakeTimers()
    const promise = sleep(1000)
    vi.advanceTimersByTime(1000)
    await promise
    vi.useRealTimers()
  })
})
