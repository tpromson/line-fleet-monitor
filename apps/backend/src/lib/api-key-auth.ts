import type { Request, Response } from 'express'
import { supabase } from './supabase.js'

export interface SourceAuth {
  sourceId: string
  organizationId: string
  sourceType: string
}

export async function requireApiKey(req: Request, res: Response): Promise<SourceAuth | null> {
  const apiKey = req.headers['x-api-key'] as string | undefined
  if (!apiKey) {
    res.status(401).json({ error: 'X-API-Key header required' })
    return null
  }

  const { data: source, error } = await supabase
    .from('sources')
    .select('id, organization_id, active, source_type:source_type_id(name)')
    .eq('api_key', apiKey)
    .single()

  if (error || !source) {
    res.status(401).json({ error: 'Invalid API key' })
    return null
  }

  if (!source.active) {
    res.status(403).json({ error: 'Source is inactive' })
    return null
  }

  const sourceType = Array.isArray(source.source_type)
    ? (source.source_type[0] as { name: string })?.name
    : (source.source_type as { name: string })?.name

  return {
    sourceId: source.id,
    organizationId: source.organization_id,
    sourceType: sourceType ?? 'unknown',
  }
}
