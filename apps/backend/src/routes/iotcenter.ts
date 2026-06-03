import type { Express, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireApiKey } from '../lib/api-key-auth.js'
import { requireSuperAdmin } from '../lib/auth.js'

export function registerIotcenterRoutes(app: Express) {
  app.post('/api/iotcenter/events', async (req: Request, res: Response) => {
    const source = await requireApiKey(req, res)
    if (!source) return

    const { device_id, event_type, level, message, payload } = req.body

    if (!event_type) {
      res.status(400).json({ error: 'event_type is required' })
      return
    }

    const { error } = await supabase.from('events').insert({
      source_id: source.sourceId,
      device_id: device_id || null,
      event_type,
      level: level || null,
      message: message || null,
      payload: payload || {},
    })

    if (error) {
      console.error('[iotcenter] Failed to insert event:', error.message)
      res.status(500).json({ error: 'Failed to record event' })
      return
    }

    if (event_type === 'heartbeat' && device_id) {
      await supabase
        .from('devices')
        .update({ status: 'online', last_seen: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', device_id)
        .eq('source_id', source.sourceId)
    }

    res.status(201).json({ status: 'recorded' })
  })

  app.post('/api/iotcenter/heartbeat', async (req: Request, res: Response) => {
    const source = await requireApiKey(req, res)
    if (!source) return

    const { device_name, device_type, metadata } = req.body

    if (!device_name) {
      res.status(400).json({ error: 'device_name is required' })
      return
    }

    const now = new Date().toISOString()

    const { data: existing } = await supabase
      .from('devices')
      .select('id')
      .eq('source_id', source.sourceId)
      .eq('device_name', device_name)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('devices')
        .update({ status: 'online', last_seen: now, updated_at: now, ...(metadata ? { metadata } : {}) })
        .eq('id', existing.id)

      await supabase.from('events').insert({
        source_id: source.sourceId,
        device_id: existing.id,
        event_type: 'heartbeat',
        level: 'info',
        message: `Device ${device_name} heartbeat received`,
        payload: metadata || {},
      })
    } else {
      const { data: created } = await supabase
        .from('devices')
        .insert({
          source_id: source.sourceId,
          device_name,
          device_type: device_type || 'unknown',
          status: 'online',
          last_seen: now,
          metadata: metadata || {},
        })
        .select('id')
        .single()

      if (created) {
        await supabase.from('events').insert({
          source_id: source.sourceId,
          device_id: created.id,
          event_type: 'device_registered',
          level: 'info',
          message: `Device ${device_name} registered via heartbeat`,
          payload: metadata || {},
        })
      }
    }

    res.status(200).json({ status: 'ok' })
  })

  app.get('/api/iotcenter/sources/:id/api-key', async (req: Request, res: Response) => {
    const auth = await requireSuperAdmin(req, res)
    if (!auth) return

    const { id } = req.params
    const { data: source, error } = await supabase
      .from('sources')
      .select('id, api_key')
      .eq('id', id)
      .single()

    if (error || !source) {
      res.status(404).json({ error: 'Source not found' })
      return
    }

    res.json({ api_key: source.api_key })
  })
}
