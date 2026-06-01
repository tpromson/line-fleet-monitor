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

  return fetch(`${getBackendUrl()}${path}`, {
    ...init,
    headers,
  })
}
