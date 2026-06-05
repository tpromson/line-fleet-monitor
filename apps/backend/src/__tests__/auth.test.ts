import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
  },
}))

import { requireAuth, requireSuperAdmin, getAuthorizedChannelAccessToken } from '../lib/auth.js'

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('requireAuth', () => {
    it('returns 401 when no authorization header', async () => {
      const req = { headers: {} } as any
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any

      await requireAuth(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authentication required' }))
    })

    it('returns 401 when authorization header is not bearer', async () => {
      const req = { headers: { authorization: 'Basic abc' } } as any
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any

      await requireAuth(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns AuthContext when token is valid', async () => {
      const mockUser = { id: 'user1', app_metadata: {} }
      const { supabase } = await import('../lib/supabase.js')
      ;(supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser }, error: null })

      const req = { headers: { authorization: 'Bearer valid-token' } } as any
      const res = {} as any

      const result = await requireAuth(req, res)

      expect(result).toMatchObject({ user: mockUser })
    })
  })

  describe('requireSuperAdmin', () => {
    it('returns 403 when user is not super_admin', async () => {
      const mockUser = { id: 'user1', app_metadata: { role: 'viewer' } }
      const { supabase } = await import('../lib/supabase.js')
      ;(supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser }, error: null })

      const req = { headers: { authorization: 'Bearer valid-token' } } as any
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any

      await requireSuperAdmin(req, res)

      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('returns AuthContext when user is super_admin', async () => {
      const mockUser = { id: 'user1', app_metadata: { role: 'super_admin' } }
      const { supabase } = await import('../lib/supabase.js')
      ;(supabase.auth.getUser as any).mockResolvedValue({ data: { user: mockUser }, error: null })

      const req = { headers: { authorization: 'Bearer valid-token' } } as any
      const res = {} as any

      const result = await requireSuperAdmin(req, res)

      expect(result).toMatchObject({ user: mockUser })
    })
  })

  describe('getAuthorizedChannelAccessToken', () => {
    it('returns access token for super_admin without org check', async () => {
      const mockChannel = { id: 'ch1', access_token: 'token123' }
      const mockAuth = {
        user: { id: 'admin1', app_metadata: { role: 'super_admin' } },
        isSuperAdmin: true,
      } as any

      const mockSupabaseFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockChannel, error: null }),
      })

      const { supabase } = await import('../lib/supabase.js')
      ;(supabase as any).from = mockSupabaseFrom

      const result = await getAuthorizedChannelAccessToken('ch1', mockAuth)

      expect(result).toEqual({ accessToken: 'token123' })
    })
  })
})
