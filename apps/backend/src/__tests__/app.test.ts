import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { supabase } from '../lib/supabase.js'

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  },
}))

vi.mock('../lib/email.js', () => ({
  sendAlertEmail: vi.fn(),
}))

vi.mock('../collector.js', () => ({
  collectAllQuotas: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../webhook-monitor.js', () => ({
  checkAllWebhooks: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../alert-engine.js', () => ({
  checkAlerts: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../lib/line-api.js', () => ({
  testChannelWebhook: vi.fn().mockResolvedValue('online'),
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

  it('POST /api/sync requires super_admin (401 without auth)', async () => {
    const res = await fetch(`${baseUrl}/api/sync`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('POST /api/sync runs as super_admin and returns 200', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'admin-1', app_metadata: { role: 'super_admin' }, email: 'a@b.c' } },
      error: null,
    })
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { authorization: 'Bearer good' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('started')
  })

  it('GET /api/users/lookup?id uses getUserById (1 call)', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'admin-1', app_metadata: { role: 'super_admin' }, email: 'a@b.c' } },
      error: null,
    })
    vi.mocked(supabase.auth.admin.getUserById).mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'u@x.com' } },
      error: null,
    })
    const res = await fetch(`${baseUrl}/api/users/lookup?id=user-1`, {
      headers: { authorization: 'Bearer good' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'user-1', email: 'u@x.com' })
    expect(supabase.auth.admin.getUserById).toHaveBeenCalledWith('user-1')
    expect(supabase.auth.admin.listUsers).not.toHaveBeenCalled()
  })

  it('GET /api/users/lookup?email= paginates with perPage=50, caps at 20 pages', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'admin-1', app_metadata: { role: 'super_admin' }, email: 'a@b.c' } },
      error: null,
    })
    vi.mocked(supabase.auth.admin.listUsers)
      .mockResolvedValueOnce({
        data: { users: Array.from({ length: 50 }, (_, i) => ({ id: `p1-${i}`, email: `p1-${i}@x.com` })) },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { users: [{ id: 'target', email: 'target@x.com' }, ...Array.from({ length: 49 }, (_, i) => ({ id: `p2-${i}`, email: `p2-${i}@x.com` }))] },
        error: null,
      })
    const res = await fetch(`${baseUrl}/api/users/lookup?email=target@x.com`, {
      headers: { authorization: 'Bearer good' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'target', email: 'target@x.com' })
    expect(supabase.auth.admin.listUsers).toHaveBeenCalledTimes(2)
  })

  it('GET /api/users/lookup returns 400 when neither email nor id', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'admin-1', app_metadata: { role: 'super_admin' }, email: 'a@b.c' } },
      error: null,
    })
    const res = await fetch(`${baseUrl}/api/users/lookup`, {
      headers: { authorization: 'Bearer good' },
    })
    expect(res.status).toBe(400)
  })

  it('GET /api/users/lookup returns 404 when not found after pagination', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'admin-1', app_metadata: { role: 'super_admin' }, email: 'a@b.c' } },
      error: null,
    })
    vi.mocked(supabase.auth.admin.listUsers).mockResolvedValue({
      data: { users: Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.com` })) },
      error: null,
    })
    const res = await fetch(`${baseUrl}/api/users/lookup?email=missing@x.com`, {
      headers: { authorization: 'Bearer good' },
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/users/lookup-batch rejects empty body with 400', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'admin-1', app_metadata: { role: 'super_admin' }, email: 'a@b.c' } },
      error: null,
    })
    const res = await fetch(`${baseUrl}/api/users/lookup-batch`, {
      method: 'POST',
      headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/users/lookup-batch rejects > 200 ids with 400', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'admin-1', app_metadata: { role: 'super_admin' }, email: 'a@b.c' } },
      error: null,
    })
    const res = await fetch(`${baseUrl}/api/users/lookup-batch`, {
      method: 'POST',
      headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
      body: JSON.stringify({ ids: Array.from({ length: 201 }, (_, i) => `id${i}`) }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/users/lookup-batch returns matches from paginated listUsers', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'admin-1', app_metadata: { role: 'super_admin' }, email: 'a@b.c' } },
      error: null,
    })
    const usersPage1 = Array.from({ length: 50 }, (_, i) => ({ id: `p1-${i}`, email: `p1-${i}@x.com` }))
    usersPage1[0] = { id: 'a', email: 'a@x.com' }
    const usersPage2 = [{ id: 'b', email: 'b@x.com' }, ...Array.from({ length: 49 }, (_, i) => ({ id: `p2-${i}`, email: `p2-${i}@x.com` }))]
    vi.mocked(supabase.auth.admin.listUsers)
      .mockResolvedValueOnce({ data: { users: usersPage1 }, error: null })
      .mockResolvedValueOnce({ data: { users: usersPage2 }, error: null })
    const res = await fetch(`${baseUrl}/api/users/lookup-batch`, {
      method: 'POST',
      headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['a', 'b', 'missing'] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users).toEqual({
      a: { id: 'a', email: 'a@x.com' },
      b: { id: 'b', email: 'b@x.com' },
    })
  })
})
