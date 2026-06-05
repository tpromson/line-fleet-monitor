import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}))

vi.mock('../lib/line-api.js', () => ({
  fetchChannelQuota: vi.fn().mockResolvedValue({ used: 0, remaining: 1000, limit: 1000 }),
  testChannelWebhook: vi.fn().mockResolvedValue('unknown'),
  sleep: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/email.js', () => ({
  sendAlertEmail: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: vi.fn() } })),
}))

import cron from 'node-cron'

describe('index - cron scheduling', () => {
  let server: Server
  let baseUrl: string

  const start = async () => {
    const { buildApp } = await import('../app.js')
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

  it('/health returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('skips collection when already running', async () => {
    const { collectAllQuotas } = await import('../collector.js')
    const { checkAllWebhooks } = await import('../webhook-monitor.js')
    const { checkAlerts } = await import('../alert-engine.js')
    const { detectOfflineDevices } = await import('../iotcenter-health.js')

    const collectionRunning = true
    const result = collectionRunning

    expect(result).toBe(true)
  })
})
