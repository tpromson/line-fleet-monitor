import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}))

const mockFetchQuota = vi.hoisted(() => vi.fn())
const mockSleep = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}))

vi.mock('../lib/line-api.js', () => ({
  fetchChannelQuota: mockFetchQuota,
  sleep: mockSleep,
}))

import { collectAllQuotas } from '../collector.js'

function createMockChannels(channels: any[]) {
  const select = vi.fn().mockReturnThis()
  const eq = vi.fn().mockResolvedValue({ data: channels, error: null })
  return { select, eq }
}

function createMockQuotaLogs() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  return { insert }
}

describe('collector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs error and returns when channel fetch fails', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') {
        const select = vi.fn().mockReturnThis()
        const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })
        return { select, eq }
      }
      return {} as any
    })

    await collectAllQuotas()

    expect(mockFetchQuota).not.toHaveBeenCalled()
  })

  it('collects quota for all active channels', async () => {
    const channels = [
      { id: 'ch1', channel_name: 'Channel1', access_token: 'token1', quota_limit: 1000 },
      { id: 'ch2', channel_name: 'Channel 2', access_token: 'token2', quota_limit: 2000 },
    ]
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') return createMockChannels(channels)
      if (table === 'quota_logs') return createMockQuotaLogs()
      return {} as any
    })

    mockFetchQuota.mockResolvedValue({ used: 100, remaining: 900, limit: 1000 })

    await collectAllQuotas()

    expect(mockFetchQuota).toHaveBeenCalledTimes(2)
    expect(mockFetchQuota).toHaveBeenCalledWith('token1', 1000)
    expect(mockFetchQuota).toHaveBeenCalledWith('token2', 2000)
  })

  it('inserts quota_logs with correct data on success', async () => {
    const channels = [
      { id: 'ch1', channel_name: 'Channel1', access_token: 'token1', quota_limit: 1000 },
    ]
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') return createMockChannels(channels)
      if (table === 'quota_logs') return { insert: insertSpy }
      return {} as any
    })

    mockFetchQuota.mockResolvedValue({ used: 300, remaining: 700, limit: 1000 })

    await collectAllQuotas()

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      channel_id: 'ch1',
      quota_limit: 1000,
      quota_used: 300,
      quota_remaining: 700,
      error: null,
    }))
  })

  it('inserts error field when quota fetch returns error', async () => {
    const channels = [
      { id: 'ch1', channel_name: 'Channel 1', access_token: 'token1', quota_limit: 1000 },
    ]
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') return createMockChannels(channels)
      if (table === 'quota_logs') return { insert: insertSpy }
      return {} as any
    })

    mockFetchQuota.mockResolvedValue({ used: 0, remaining: 0, limit: 1000, error: 'RATE_LIMITED' })

    await collectAllQuotas()

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      channel_id: 'ch1',
      error: 'RATE_LIMITED',
    }))
  })

  it('handles unexpected errors per channel without stopping batch', async () => {
    const channels = [
      { id: 'ch1', channel_name: 'Channel 1', access_token: 'token1', quota_limit: 1000 },
      { id: 'ch2', channel_name: 'Channel 2', access_token: 'token2', quota_limit: 2000 },
    ]
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') return createMockChannels(channels)
      if (table === 'quota_logs') return createMockQuotaLogs()
      return {} as any
    })

    mockFetchQuota
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValue({ used: 100, remaining: 1900, limit: 2000 })

    await collectAllQuotas()

    expect(mockFetchQuota).toHaveBeenCalledTimes(2)
  })

  it('sleeps between batches when more channels remain', async () => {
    const channels = [
      { id: 'ch1', channel_name: 'Channel 1', access_token: 'token1', quota_limit: 1000 },
      { id: 'ch2', channel_name: 'Channel 2', access_token: 'token2', quota_limit: 1000 },
      { id: 'ch3', channel_name: 'Channel 3', access_token: 'token3', quota_limit: 1000 },
      { id: 'ch4', channel_name: 'Channel 4', access_token: 'token4', quota_limit: 1000 },
    ]
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') return createMockChannels(channels)
      if (table === 'quota_logs') return createMockQuotaLogs()
      return {} as any
    })

    mockFetchQuota.mockResolvedValue({ used: 0, remaining: 1000, limit: 1000 })

    await collectAllQuotas()

    expect(mockSleep).toHaveBeenCalledWith(300)
  })
})
