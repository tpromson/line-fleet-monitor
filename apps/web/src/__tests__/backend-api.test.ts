import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
  },
}))

describe('backend API helper', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('VITE_BACKEND_URL', 'https://backend.example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('sends the Supabase access token as a bearer token', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'session-token' } },
    })

    const { fetchBackend } = await import('@/lib/backend-api')
    await fetchBackend('/api/sync', { method: 'POST' })

    expect(fetch).toHaveBeenCalledWith(
      'https://backend.example.com/api/sync',
      expect.objectContaining({ method: 'POST' }),
    )
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer session-token')
  })

  it('preserves existing headers when adding authorization', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'session-token' } },
    })

    const { fetchBackend } = await import('@/lib/backend-api')
    await fetchBackend('/api/users/lookup?email=user@example.com', {
      headers: { Accept: 'application/json' },
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://backend.example.com/api/users/lookup?email=user@example.com',
      expect.any(Object),
    )
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Headers).get('Accept')).toBe('application/json')
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer session-token')
  })
})
