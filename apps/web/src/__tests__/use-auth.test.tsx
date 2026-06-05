import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { mockGetSession, mockOnAuthStateChange } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
    },
  },
}))

import { useAuth } from '@/hooks/use-auth'

const TestComponent = () => {
  const { user, loading, isSuperAdmin } = useAuth()
  return (
    <div>
      <span data-testid="loading">{loading ? 'loading' : 'done'}</span>
      <span data-testid="user">{user?.email ?? 'no-user'}</span>
      <span data-testid="superadmin">{isSuperAdmin ? 'yes' : 'no'}</span>
    </div>
  )
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets loading true initially', () => {
    mockGetSession.mockReturnValue(new Promise(() => {}))
    render(<TestComponent />)
    expect(screen.getByTestId('loading')).toHaveTextContent('loading')
  })

  it('sets user from session', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'test@example.com', app_metadata: {} } } },
    })
    render(<TestComponent />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('done'))
    expect(screen.getByTestId('user')).toHaveTextContent('test@example.com')
  })

  it('sets isSuperAdmin true when role is super_admin', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'admin@example.com', app_metadata: { role: 'super_admin' } } } },
    })
    render(<TestComponent />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('done'))
    expect(screen.getByTestId('superadmin')).toHaveTextContent('yes')
  })

  it('sets isSuperAdmin false when role is not super_admin', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'user@example.com', app_metadata: { role: 'viewer' } } } },
    })
    render(<TestComponent />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('done'))
    expect(screen.getByTestId('superadmin')).toHaveTextContent('no')
  })

  it('sets user to null when no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    render(<TestComponent />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('done'))
    expect(screen.getByTestId('user')).toHaveTextContent('no-user')
  })

  it('subscribes to auth state changes', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    render(<TestComponent />)
    expect(mockOnAuthStateChange).toHaveBeenCalled()
  })
})
