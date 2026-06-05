import { supabase } from '@/lib/supabase'

export function getBackendUrl(): string | null {
  const backendUrl = import.meta.env.VITE_BACKEND_URL
  return backendUrl || null
}

export async function fetchBackend(path: string, init: RequestInit = {}) {
  const baseUrl = getBackendUrl()
  if (!baseUrl) {
    throw new Error('Backend URL not configured (VITE_BACKEND_URL)')
  }

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = new Headers(init.headers)

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers })

  if (response.status === 401 && token) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    const newToken = refreshed.session?.access_token
    if (newToken) {
      const retryHeaders = new Headers(init.headers)
      retryHeaders.set('Authorization', `Bearer ${newToken}`)
      return fetch(`${baseUrl}${path}`, { ...init, headers: retryHeaders })
    }
  }

  return response
}
