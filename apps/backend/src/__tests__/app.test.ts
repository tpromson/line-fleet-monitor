import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }) },
    },
  },
}))

vi.mock('../lib/email.js', () => ({
  sendAlertEmail: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: vi.fn() } })),
}))

import { buildApp } from '../app.js'

describe('app middleware', () => {
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
    vi.stubEnv('RATE_LIMIT_MAX', '5')
    await start()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await stop()
  })

  it('buildApp throws when CORS_ORIGIN is missing', async () => {
    vi.stubEnv('CORS_ORIGIN', '')
    await expect(start()).rejects.toThrow(/CORS_ORIGIN/)
  })

  it('serves /health', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('reflects CORS_ORIGIN and handles OPTIONS preflight', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://allowed.example.com' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://allowed.example.com',
    )
  })

  it('sets helmet security headers', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=/)
  })

  it('rejects request bodies larger than 100kb', async () => {
    const big = 'a'.repeat(101 * 1024)
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(big)) },
      body: big,
    })
    expect(res.status).toBe(413)
  })

  it('rate-limits /api/* after the configured max', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/users/lookup`, {
        headers: { authorization: 'Bearer fake' },
      })
      expect(res.status).not.toBe(429)
    }
    const blocked = await fetch(`${baseUrl}/api/users/lookup`, {
      headers: { authorization: 'Bearer fake' },
    })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })

  it('does not rate-limit /health', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/health`)
      expect(res.status).toBe(200)
    }
  })
})
