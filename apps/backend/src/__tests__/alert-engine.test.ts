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
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ quota_used: null }], null))
    await checkAlerts()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('fires warning alert when usage >= 80% and no prior alert', async () => {
    const insertSpy = vi.fn().mockResolvedValue({})
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ quota_used: 850 }], null, insertSpy))
    await checkAlerts()
    expect(mockSendEmail).toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }))
  })

  it('fires critical alert when usage >= 95%', async () => {
    const insertSpy = vi.fn().mockResolvedValue({})
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ quota_used: 960 }], null, insertSpy))
    await checkAlerts()
    expect(mockSendEmail).toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'critical' }))
  })

  it('does not fire alert when usage stays at same level', async () => {
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ quota_used: 850 }], { level: 'warning' }))
    await checkAlerts()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('fires normal alert when usage drops below 80% from warning', async () => {
    const insertSpy = vi.fn().mockResolvedValue({})
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ quota_used: 500 }], { level: 'warning' }, insertSpy))
    await checkAlerts()
    expect(mockSendEmail).toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'normal' }))
  })

  it('does not fire normal alert when no prior alert exists', async () => {
    mockSupabase.from.mockImplementation((table: string) => createMockTable(table, [{ quota_used: 500 }], null))
    await checkAlerts()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

function createMockTable(
  table: string,
  quotaLogs: { quota_used: number | null }[] | null,
  lastAlert: { level: string } | null,
  insertSpy = vi.fn().mockResolvedValue({}),
) {
  const base = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn(),
    insert: insertSpy,
  }

  if (table === 'channels') {
    base.select = vi.fn().mockReturnValue(base)
    base.eq = vi.fn().mockResolvedValue({
      data: [{ id: 'ch1', channel_name: 'Test Channel', quota_limit: 1000 }],
    })
    return base
  }

  if (table === 'quota_logs') {
    const logEntry = quotaLogs && quotaLogs.length > 0 ? quotaLogs[0] : null
    base.select = vi.fn().mockReturnValue(base)
    base.eq = vi.fn().mockReturnValue(base)
    base.is = vi.fn().mockReturnValue(base)
    base.order = vi.fn().mockReturnValue(base)
    base.limit = vi.fn().mockReturnValue(base)
    base.single = vi.fn().mockResolvedValue({ data: logEntry && logEntry.quota_used !== null ? logEntry : null })
    return base
  }

  if (table === 'alerts') {
    base.select = vi.fn().mockReturnValue(base)
    base.eq = vi.fn().mockReturnValue(base)
    base.order = vi.fn().mockReturnValue(base)
    base.limit = vi.fn().mockReturnValue(base)
    base.single = vi.fn().mockResolvedValue({ data: lastAlert })
    base.insert = insertSpy
    return base
  }

  return base
}
