import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}))

const mockSendMophNotify = vi.hoisted(() => vi.fn().mockResolvedValue({ status: 'sent' }))

const { mockResendFn } = vi.hoisted(() => {
  vi.stubEnv('RESEND_API_KEY', 're_test_key')
  return {
    mockResendFn: vi.fn().mockImplementation(() => ({ emails: { send: vi.fn() } })),
  }
})

vi.mock('../lib/supabase.js', () => ({
  supabase: mockSupabase,
}))

vi.mock('../lib/email.js', () => ({
  sendAlertEmail: vi.fn(),
}))

vi.mock('../lib/moph-notify.js', () => ({
  sendMophNotify: mockSendMophNotify,
}))

vi.mock('resend', () => ({
  Resend: mockResendFn,
}))

import { buildApp } from '../app.js'

function mockSourcesResponse(data: unknown, error: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data, error })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  return { select, eq, single }
}

function mockDevicesLookup(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const ilike = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ ilike })
  const select = vi.fn().mockReturnValue({ eq })
  return { select, eq, ilike, maybeSingle }
}

describe('iotcenter routes', () => {
  let server: Server
  let baseUrl: string

  const start = async () => {
    server = createServer(buildApp())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  }

  const stop = () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )

  beforeEach(async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://allowed.example.com')
    vi.stubEnv('RATE_LIMIT_MAX', '100')
    vi.clearAllMocks()
    await start()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await stop()
  })

  describe('POST /api/iotcenter/events', () => {
    it('rejects requests without API key', async () => {
      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event_type: 'test' }),
      })
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toContain('X-API-Key')
    })

    it('rejects invalid API key', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse(null, { message: 'not found' })
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'invalid-key' },
        body: JSON.stringify({ event_type: 'test' }),
      })
      expect(res.status).toBe(401)
    })

    it('rejects inactive source', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: false,
          source_type: { name: 'temperature' },
        })
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({ event_type: 'test' }),
      })
      expect(res.status).toBe(403)
    })

    it('rejects request without event_type', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({ level: 'warning' }),
      })
      expect(res.status).toBe(400)
    })

    it('inserts event and returns 201', async () => {
      const insertSpy = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'google_apps_script' },
        })
        if (table === 'events') return { insert: insertSpy } as any
        if (table === 'devices') return { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          event_type: 'HIGH_TEMP',
          level: 'warning',
          message: 'Temperature exceeds threshold',
          payload: { temperature: 28.5 },
        }),
      })
      expect(res.status).toBe(201)
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
        source_id: 'src-1',
        event_type: 'HIGH_TEMP',
        level: 'warning',
        message: 'Temperature exceeds threshold',
      }))
    })

    it('sends MOPH Notify when temperature changes from normal to high', async () => {
      vi.stubEnv('MOPH_NOTIFY_ENABLED', 'true')
      const insertSpy = vi.fn().mockResolvedValue({ error: null })
      const previousLimit = vi.fn().mockResolvedValue({ data: [{ event_type: 'TEMP_NORMAL' }] })
      const previousOrder = vi.fn().mockReturnValue({ limit: previousLimit })
      const previousIn = vi.fn().mockReturnValue({ order: previousOrder })
      const previousEq = vi.fn().mockReturnValue({ in: previousIn })
      const previousSelect = vi.fn().mockReturnValue({ eq: previousEq })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'events') return { select: previousSelect, insert: insertSpy } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          event_type: 'HIGH_TEMP',
          level: 'warning',
          message: 'อุณหภูมิเกินเกณฑ์',
          payload: { temperature: 28.5, threshold: 25 },
        }),
      })

      expect(res.status).toBe(201)
      expect(mockSendMophNotify).toHaveBeenCalledWith(expect.stringContaining('28.5'), 'org-1')
      expect(mockSendMophNotify).toHaveBeenCalledWith(expect.stringContaining('25.0'), 'org-1')
    })

    it('updates device status on heartbeat event', async () => {
      const eventInsertSpy = vi.fn().mockResolvedValue({ error: null })
      const deviceEq2 = vi.fn().mockResolvedValue({ error: null })
      const deviceEq1 = vi.fn().mockReturnValue({ eq: deviceEq2 })
      const deviceUpdateSpy = vi.fn().mockReturnValue({ eq: deviceEq1 })
      const deviceSelectMaybeSingle = vi.fn().mockResolvedValue({ data: { last_seen: '2024-01-01T00:00:00.000Z' } })
      const deviceSelectEq = vi.fn().mockReturnValue({ maybeSingle: deviceSelectMaybeSingle })
      const deviceSelectSpy = vi.fn().mockReturnValue({ eq: deviceSelectEq })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'iot' },
        })
        if (table === 'events') return { insert: eventInsertSpy } as any
        if (table === 'devices') return { select: deviceSelectSpy, update: deviceUpdateSpy } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({ device_id: 'dev-1', event_type: 'heartbeat', level: 'info' }),
      })
      expect(res.status).toBe(201)
      expect(deviceUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'online' }))
    })

    it('does not advance last_seen on a bare heartbeat event with no temperature', async () => {
      const eventInsertSpy = vi.fn().mockResolvedValue({ error: null })
      const deviceEq2 = vi.fn().mockResolvedValue({ error: null })
      const deviceEq1 = vi.fn().mockReturnValue({ eq: deviceEq2 })
      const deviceUpdateSpy = vi.fn().mockReturnValue({ eq: deviceEq1 })
      const staleLastSeen = '2024-01-01T00:00:00.000Z'
      const deviceSelectMaybeSingle = vi.fn().mockResolvedValue({ data: { last_seen: staleLastSeen } })
      const deviceSelectEq = vi.fn().mockReturnValue({ maybeSingle: deviceSelectMaybeSingle })
      const deviceSelectSpy = vi.fn().mockReturnValue({ eq: deviceSelectEq })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'iot' },
        })
        if (table === 'events') return { insert: eventInsertSpy } as any
        if (table === 'devices') return { select: deviceSelectSpy, update: deviceUpdateSpy } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({ device_id: 'dev-1', event_type: 'heartbeat', level: 'info' }),
      })
      expect(res.status).toBe(201)
      expect(deviceUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ last_seen: staleLastSeen }))
    })
  })

  describe('POST /api/iotcenter/heartbeat', () => {
    it('rejects heartbeat without device_name', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('creates new device on first heartbeat', async () => {
      const insertSelectSpy = vi.fn().mockReturnThis()
      const insertSingleSpy = vi.fn().mockResolvedValue({ data: { id: 'dev-new' }, error: null })
      const deviceInsertSpy = vi.fn().mockReturnValue({ select: insertSelectSpy, single: insertSingleSpy })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          ...mockDevicesLookup(null),
          insert: deviceInsertSpy,
        } as any
        if (table === 'events') return { insert: vi.fn().mockResolvedValue({ error: null }) } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({ device_name: 'fridge-1', device_type: 'refrigerator', metadata: { location: 'Ward A' } }),
      })
      expect(res.status).toBe(200)
      expect(deviceInsertSpy).toHaveBeenCalledWith(expect.objectContaining({
        source_id: 'src-1',
        device_name: 'fridge-1',
        device_type: 'refrigerator',
        status: 'online',
      }))
    })

    it('updates existing device on heartbeat', async () => {
      const updateEq = vi.fn().mockResolvedValue({ error: null })
      const deviceUpdateSpy = vi.fn().mockReturnValue({ eq: updateEq })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          ...mockDevicesLookup({ id: 'dev-1' }),
          update: deviceUpdateSpy,
        } as any
        if (table === 'events') return { insert: vi.fn().mockResolvedValue({ error: null }) } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({ device_name: 'fridge-1' }),
      })
      expect(res.status).toBe(200)
      expect(deviceUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'online' }))
    })

    it('sends MOPH Notify when a valid heartbeat recovers an offline device', async () => {
      vi.stubEnv('MOPH_NOTIFY_ENABLED', 'true')
      const updateEq = vi.fn().mockResolvedValue({ error: null })
      const deviceUpdateSpy = vi.fn().mockReturnValue({ eq: updateEq })
      const eventInsertSpy = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          ...mockDevicesLookup({
            id: 'dev-1',
            status: 'offline',
            last_seen: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            metadata: { sensor_status: 'offline' },
          }),
          update: deviceUpdateSpy,
        } as any
        if (table === 'events') return { insert: eventInsertSpy } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          device_name: 'fridge-1',
          metadata: { lastTemperature: 6.8, lastRow: 37134 },
        }),
      })

      expect(res.status).toBe(200)
      expect(mockSendMophNotify).toHaveBeenCalledWith(
        expect.stringContaining('กลับมา Online'),
        'org-1',
      )
    })
  })

  describe('outlier filter (25°C on reconnect)', () => {
    function setupDeviceMock(deviceData: { id: string; status: string; last_seen: string } | null) {
      const maybeSingle = vi.fn().mockResolvedValue({ data: deviceData, error: null })
      const ilike = vi.fn().mockReturnValue({ maybeSingle })
      const eq2 = vi.fn().mockReturnValue({ ilike, maybeSingle })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2, ilike, maybeSingle })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      return { select, eq1, eq2, ilike, maybeSingle }
    }

    it('filters 25°C on /events when device was recently offline', async () => {
      const eventsInsert = vi.fn()
      const outlierInsert = vi.fn().mockResolvedValue({ error: null })
      const device = setupDeviceMock({
        id: 'dev-1', status: 'offline', last_seen: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          select: device.select,
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        } as any
        if (table === 'events') return { insert: eventsInsert } as any
        if (table === 'outlier_logs') return { insert: outlierInsert } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          device_id: 'dev-1',
          event_type: 'TEMP_NORMAL',
          payload: { temperature: 25, humidity: 60 },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('filtered_outlier')
      expect(outlierInsert).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'reconnect_25c', temperature: 25, device_id: 'dev-1',
      }))
      expect(eventsInsert).not.toHaveBeenCalled()
    })

    it('accepts 25°C on /events when device is healthy', async () => {
      const eventsInsert = vi.fn().mockResolvedValue({ error: null })
      const outlierInsert = vi.fn()
      const device = setupDeviceMock({
        id: 'dev-1', status: 'online', last_seen: new Date(Date.now() - 5 * 1000).toISOString(),
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          select: device.select,
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        } as any
        if (table === 'events') return { insert: eventsInsert } as any
        if (table === 'outlier_logs') return { insert: outlierInsert } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          device_id: 'dev-1',
          event_type: 'TEMP_NORMAL',
          payload: { temperature: 25, humidity: 60 },
        }),
      })

      expect(res.status).toBe(201)
      expect(eventsInsert).toHaveBeenCalled()
      expect(outlierInsert).not.toHaveBeenCalled()
    })

    it('accepts non-25°C readings on reconnect', async () => {
      const eventsInsert = vi.fn().mockResolvedValue({ error: null })
      const outlierInsert = vi.fn()
      const device = setupDeviceMock({
        id: 'dev-1', status: 'offline', last_seen: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          select: device.select,
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        } as any
        if (table === 'events') return { insert: eventsInsert } as any
        if (table === 'outlier_logs') return { insert: outlierInsert } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          device_id: 'dev-1',
          event_type: 'TEMP_NORMAL',
          payload: { temperature: 4.2, humidity: 60 },
        }),
      })

      expect(res.status).toBe(201)
      expect(eventsInsert).toHaveBeenCalled()
      expect(outlierInsert).not.toHaveBeenCalled()
    })

    it('filters 25°C heartbeat when device was recently offline', async () => {
      const eventsInsert = vi.fn()
      const outlierInsert = vi.fn().mockResolvedValue({ error: null })
      const deviceUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })

      const maybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'dev-1', status: 'offline', last_seen: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
        error: null,
      })
      const ilike = vi.fn().mockReturnValue({ maybeSingle })
      const eq2 = vi.fn().mockReturnValue({ ilike, maybeSingle })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2, ilike, maybeSingle })
      const select = vi.fn().mockReturnValue({ eq: eq1 })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          select,
          update: deviceUpdate,
          ilike,
          eq: vi.fn().mockReturnThis(),
        } as any
        if (table === 'events') return { insert: eventsInsert } as any
        if (table === 'outlier_logs') return { insert: outlierInsert } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          device_name: 'fridge-1',
          metadata: { temperature: 25, humidity: 60 },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('filtered_outlier')
      expect(outlierInsert).toHaveBeenCalledWith(expect.objectContaining({ reason: 'reconnect_25c' }))
      expect(eventsInsert).not.toHaveBeenCalled()
    })

    it('filters 25°C heartbeat when device was online but last_seen gap > 20s (regression test)', async () => {
      const eventsInsert = vi.fn()
      const outlierInsert = vi.fn().mockResolvedValue({ error: null })
      const deviceUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const maybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'dev-1', status: 'online', last_seen: fiveMinAgo },
        error: null,
      })
      const ilike = vi.fn().mockReturnValue({ maybeSingle })
      const eq2 = vi.fn().mockReturnValue({ ilike, maybeSingle })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2, ilike, maybeSingle })
      const select = vi.fn().mockReturnValue({ eq: eq1 })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          select,
          update: deviceUpdate,
          ilike,
          eq: vi.fn().mockReturnThis(),
        } as any
        if (table === 'events') return { insert: eventsInsert } as any
        if (table === 'outlier_logs') return { insert: outlierInsert } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          device_name: 'fridge-1',
          metadata: { temperature: 25, humidity: 60 },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('filtered_outlier')
      expect(outlierInsert).toHaveBeenCalledWith(expect.objectContaining({ reason: 'reconnect_25c' }))
      expect(eventsInsert).not.toHaveBeenCalled()
    })

    it('accepts 25°C heartbeat when device just heartbeat < 20s ago', async () => {
      const eventsInsert = vi.fn().mockResolvedValue({ error: null })
      const outlierInsert = vi.fn()
      const deviceUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })

      const fiveSecAgo = new Date(Date.now() - 5 * 1000).toISOString()
      const maybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'dev-1', status: 'online', last_seen: fiveSecAgo },
        error: null,
      })
      const ilike = vi.fn().mockReturnValue({ maybeSingle })
      const eq2 = vi.fn().mockReturnValue({ ilike, maybeSingle })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2, ilike, maybeSingle })
      const select = vi.fn().mockReturnValue({ eq: eq1 })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'temperature' },
        })
        if (table === 'devices') return {
          select,
          update: deviceUpdate,
          ilike,
          eq: vi.fn().mockReturnThis(),
        } as any
        if (table === 'events') return { insert: eventsInsert } as any
        if (table === 'outlier_logs') return { insert: outlierInsert } as any
        return {} as any
      })

      const res = await fetch(`${baseUrl}/api/iotcenter/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: JSON.stringify({
          device_name: 'fridge-1',
          metadata: { temperature: 25, humidity: 60 },
        }),
      })

      expect(res.status).toBe(200)
      expect(eventsInsert).toHaveBeenCalled()
      expect(outlierInsert).not.toHaveBeenCalled()
    })
  })

  describe('GET /public/iotcenter/temperature/:sourceId/chart', () => {
    function chartEventsAsc(events: { created_at: string; temperature: number }[]) {
      return events
    }

    it('filters 25°C first-after-gap in ASCENDING order events (regression)', async () => {
      const now = Date.now()
      const events = [
        { created_at: new Date(now - 60 * 60 * 1000).toISOString(), payload: { temperature: 4 } },
        { created_at: new Date(now - 50 * 60 * 1000).toISOString(), payload: { temperature: 4 } },
        { created_at: new Date(now - 5 * 60 * 1000).toISOString(), payload: { temperature: 25 } },
        { created_at: new Date(now - 4 * 60 * 1000).toISOString(), payload: { temperature: 4 } },
      ]

      const eventsOrder = vi.fn().mockResolvedValue({ data: events, error: null })
      const eventsGte = vi.fn().mockReturnValue({ order: eventsOrder })
      const eventsIn = vi.fn().mockReturnValue({ gte: eventsGte })
      const eventsEq = vi.fn().mockReturnValue({ in: eventsIn })
      const eventsSelect = vi.fn().mockReturnValue({ eq: eventsEq })

      const configSingle = vi.fn().mockResolvedValue({ data: { source_id: 'src-1' }, error: null })
      const configEq2 = vi.fn().mockReturnValue({ single: configSingle })
      const configEq1 = vi.fn().mockReturnValue({ eq: configEq2 })
      const configSelect = vi.fn().mockReturnValue({ eq: configEq1 })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'public_configs') {
          return { select: configSelect } as any
        }
        if (table === 'events') {
          return { select: eventsSelect } as any
        }
        return {} as any
      })

      const res = await fetch(`${baseUrl}/public/iotcenter/temperature/src-1/chart?range=1d`)
      expect(res.status).toBe(200)
      const body = await res.json()
      const temps = body.data.map((p: { temperature: number }) => p.temperature)
      expect(temps).toEqual([4, 4, 4])
      expect(temps).not.toContain(25)
    })
  })
})
