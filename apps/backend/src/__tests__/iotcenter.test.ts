import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}))

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
  const eq2 = vi.fn().mockReturnValue({ maybeSingle })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2, maybeSingle })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, eq: eq1, maybeSingle }
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

    it('updates device status on heartbeat event', async () => {
      const eventInsertSpy = vi.fn().mockResolvedValue({ error: null })
      const deviceEq2 = vi.fn().mockResolvedValue({ error: null })
      const deviceEq1 = vi.fn().mockReturnValue({ eq: deviceEq2 })
      const deviceUpdateSpy = vi.fn().mockReturnValue({ eq: deviceEq1 })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'sources') return mockSourcesResponse({
          id: 'src-1', organization_id: 'org-1', active: true,
          source_type: { name: 'iot' },
        })
        if (table === 'events') return { insert: eventInsertSpy } as any
        if (table === 'devices') return { update: deviceUpdateSpy } as any
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
  })
})
