import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}))

const mockSendEmail = vi.hoisted(() => vi.fn())

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}))

vi.mock('../lib/email.js', () => ({
  sendAlertEmail: mockSendEmail,
}))

import { checkAlerts } from '../alert-engine.js'

describe('alert-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ALERT_EMAIL_TO', 'admin@example.com')
  })

  it('skips when no channels found', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'channels') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [] }) } as any
      }
      return {} as any
    })

    await checkAlerts()

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('skips channel when no quota_logs found', async () => {
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [], null))
    await checkAlerts()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('fires warning alert when usage >= 80% and no prior alert', async () => {
    const insertSpy = vi.fn().mockResolvedValue({})
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ channel_id: 'ch1', quota_used: 850 }], null, insertSpy))
    await checkAlerts()
    expect(mockSendEmail).toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ level: 'warning' })]))
  })

  it('fires critical alert when usage >= 95%', async () => {
    const insertSpy = vi.fn().mockResolvedValue({})
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ channel_id: 'ch1', quota_used: 960 }], null, insertSpy))
    await checkAlerts()
    expect(mockSendEmail).toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ level: 'critical' })]))
  })

  it('does not fire alert when usage stays at same level', async () => {
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ channel_id: 'ch1', quota_used: 850 }], { level: 'warning' }))
    await checkAlerts()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('fires recovery alert when usage drops below 80% from warning', async () => {
    const insertSpy = vi.fn().mockResolvedValue({})
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ channel_id: 'ch1', quota_used: 500 }], { level: 'warning' }, insertSpy))
    await checkAlerts()
    expect(mockSendEmail).toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ level: 'recovery' })]))
  })

  it('does not fire recovery alert when no prior alert exists', async () => {
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ channel_id: 'ch1', quota_used: 500 }], null))
    await checkAlerts()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

function createMockTable(
  table: string,
  quotaLogs: { channel_id: string; quota_used: number | null }[],
  lastAlertResult: { level: string } | null,
  insertSpy = vi.fn().mockResolvedValue({}),
) {
  if (table === 'channels') {
    const select = vi.fn().mockReturnThis()
    const eq = vi.fn().mockResolvedValue({
      data: [{ id: 'ch1', channel_name: 'Test Channel', quota_limit: 1000 }],
    })
    select.mockReturnValue({ eq })
    return { select, eq } as any
  }

  if (table === 'quota_logs') {
    const select = vi.fn().mockReturnThis()
    const inFn = vi.fn().mockReturnThis()
    const isFn = vi.fn().mockReturnThis()
    const order = vi.fn().mockReturnThis()
    const limit = vi.fn().mockReturnThis()
    const promise = Promise.resolve({ data: quotaLogs })
    limit.mockReturnValue(promise)
    order.mockReturnValue({ limit })
    isFn.mockReturnValue({ order, limit })
    inFn.mockReturnValue({ is: isFn, order, limit })
    select.mockReturnValue({ in: inFn, order, limit })
    return { select, in: inFn, limit } as any
  }

  if (table === 'alerts') {
    const select = vi.fn().mockReturnThis()
    const inFn = vi.fn().mockReturnThis()
    const order = vi.fn().mockReturnThis()
    const data = lastAlertResult ? [{ channel_id: 'ch1', level: lastAlertResult.level }] : []
    order.mockReturnValue({ then: (cb: any) => cb({ data }) })
    inFn.mockReturnValue({ order })
    select.mockReturnValue({ in: inFn })
    return { select, in: inFn, insert: insertSpy } as any
  }

  return {} as any
}
