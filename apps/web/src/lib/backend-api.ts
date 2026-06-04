import { supabase } from '@/lib/supabase'

export function getBackendUrl() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL
  if (!backendUrl) throw new Error('Backend URL not configured')
  return backendUrl
}

export async function fetchBackend(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = new Headers(init.headers)

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${getBackendUrl()}${path}`, { ...init, headers })

  if (response.status === 401 && token) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    const newToken = refreshed.session?.access_token
    if (newToken) {
      const retryHeaders = new Headers(init.headers)
      retryHeaders.set('Authorization', `Bearer ${newToken}`)
      return fetch(`${getBackendUrl()}${path}`, { ...init, headers: retryHeaders })
    }
  }

  return response
}
