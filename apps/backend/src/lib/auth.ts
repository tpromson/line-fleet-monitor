import type { Request, Response } from 'express'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase.js'

export interface AuthContext {
  user: User
  isSuperAdmin: boolean
}

function getBearerToken(req: Request) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

export async function requireAuth(req: Request, res: Response): Promise<AuthContext | null> {
  const token = getBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return null
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid session' })
    return null
  }

  return {
    user: data.user,
    isSuperAdmin: data.user.app_metadata?.role === 'super_admin',
  }
}

export async function requireSuperAdmin(req: Request, res: Response): Promise<AuthContext | null> {
  const auth = await requireAuth(req, res)
  if (!auth) return null

  if (!auth.isSuperAdmin) {
    res.status(403).json({ error: 'Super admin required' })
    return null
  }

  return auth
}

export async function getAuthorizedChannelAccessToken(channelId: string, auth: AuthContext) {
  const { data: channel } = await supabase
    .from('channels')
    .select('access_token, provider:provider_id(organization_id)')
    .eq('id', channelId)
    .single()

  if (!channel?.access_token) {
    return { status: 404, error: 'Channel not found' }
  }

  if (auth.isSuperAdmin) {
    return { accessToken: channel.access_token as string }
  }

  const provider = Array.isArray(channel.provider) ? channel.provider[0] : channel.provider
  const organizationId = provider?.organization_id
  if (!organizationId) {
    return { status: 404, error: 'Channel not found' }
  }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!membership) {
    return { status: 403, error: 'Channel access denied' }
  }

  return { accessToken: channel.access_token as string }
}
