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

  it('stores webhook status and checked timestamp for each active channel', async () => {
    const updateSpy = vi.fn().mockReturnThis()
    const eqSpy = vi.fn().mockResolvedValue({})
    const upsertSpy = vi.fn().mockResolvedValue({})

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'ch1', channel_name: 'Test Channel', access_token: 'token' }],
          }),
          update: updateSpy,
          upsert: upsertSpy,
        } as any
      }
      return {} as any
    })
    updateSpy.mockReturnValue({ eq: eqSpy })
    mockTestWebhook.mockResolvedValue('online')

    await checkAllWebhooks()

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ch1',
          webhook_status: 'online',
          webhook_checked_at: expect.any(String),
        }),
      ]),
    )
  })

  it('falls back to per-id update when bulk upsert fails', async () => {
    const updateSpy = vi.fn().mockReturnThis()
    const eqSpy = vi.fn().mockResolvedValue({})
    const upsertSpy = vi.fn().mockResolvedValue({ error: { message: 'bulk fail' } })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'ch1', channel_name: 'Test Channel', access_token: 'token' }],
          }),
          update: updateSpy,
          upsert: upsertSpy,
        } as any
      }
      return {} as any
    })
    updateSpy.mockReturnValue({ eq: eqSpy })
    mockTestWebhook.mockResolvedValue('online')

    await checkAllWebhooks()

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      webhook_status: 'online',
      webhook_checked_at: expect.any(String),
    }))
    expect(eqSpy).toHaveBeenCalledWith('id', 'ch1')
  })
})
