import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.auth.refreshSession()
    if (!error && data.user) setUser(data.user)
  }, [])

  const isSuperAdmin = user?.app_metadata?.role === 'super_admin'

  return { user, loading, isSuperAdmin, refresh }
}
