import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}))

const mockTestWebhook = vi.hoisted(() => vi.fn())

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}))

vi.mock('../lib/line-api.js', () => ({
  testChannelWebhook: mockTestWebhook,
  sleep: vi.fn().mockResolvedValue(undefined),
}))

import { checkAllWebhooks } from '../webhook-monitor.js'

describe('webhook-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores webhook status and checked timestamp for each active channel via per-row update', async () => {
    const updateSpy = vi.fn().mockReturnThis()
    const eqSpy = vi.fn().mockResolvedValue({})

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'ch1', channel_name: 'Test Channel', access_token: 'token' }],
          }),
          update: updateSpy,
        } as any
      }
      return {} as any
    })
    updateSpy.mockReturnValue({ eq: eqSpy })
    mockTestWebhook.mockResolvedValue('online')

    await checkAllWebhooks()

    // Per-row update() + eq('id', ...) — not upsert(), which fails NOT NULL checks
    // (provider_id, channel_name, access_token) on its INSERT ... ON CONFLICT branch.
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      webhook_status: 'online',
      webhook_checked_at: expect.any(String),
    }))
    expect(eqSpy).toHaveBeenCalledWith('id', 'ch1')
  })

  it('logs but does not throw when a per-row update fails', async () => {
    const updateSpy = vi.fn().mockReturnThis()
    const eqSpy = vi.fn().mockResolvedValue({ error: { message: 'update failed' } })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'ch1', channel_name: 'Test Channel', access_token: 'token' }],
          }),
          update: updateSpy,
        } as any
      }
      return {} as any
    })
    updateSpy.mockReturnValue({ eq: eqSpy })
    mockTestWebhook.mockResolvedValue('online')

    await expect(checkAllWebhooks()).resolves.not.toThrow()
    expect(eqSpy).toHaveBeenCalledWith('id', 'ch1')
  })
})
