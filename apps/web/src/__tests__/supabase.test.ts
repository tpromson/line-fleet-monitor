import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('supabase client', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws when VITE_SUPABASE_URL is not set', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')

    await expect(import('@/lib/supabase')).rejects.toThrow(/supabaseUrl/)
  })

  it('throws when VITE_SUPABASE_ANON_KEY is not set', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')

    await expect(import('@/lib/supabase')).rejects.toThrow(/supabaseKey/)
  })

  it('creates client with correct URL and key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')

    const { supabase } = await import('@/lib/supabase')

    expect(supabase).toBeDefined()
  })
})
