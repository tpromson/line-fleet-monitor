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
      .ilike('device_name', device_name)
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

  app.get('/public/iotcenter/temperature', async (_req: Request, res: Response) => {
    const now = new Date()
    const todayStr = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok' })
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const { data: configs } = await supabase
      .from('public_configs')
      .select('source_id, display_name, show_temperature, show_humidity, show_min_max, show_avg, show_chart, display_order')
      .eq('enabled', true)
      .order('display_order')

    if (!configs || configs.length === 0) {
      res.json({ widgets: [] })
      return
    }

    const sourceIds = configs.map((c) => c.source_id)

    const { data: sources } = await supabase
      .from('sources')
      .select('id, name, metadata, active')
      .in('id', sourceIds)
      .eq('active', true)

    if (!sources || sources.length === 0) {
      res.json({ widgets: [] })
      return
    }

    const { data: events } = await supabase
      .from('events')
      .select('source_id, event_type, level, payload, created_at')
      .in('source_id', sourceIds)
      .gte('created_at', oneDayAgo.toISOString())
      .order('created_at', { ascending: false })

    const { data: latestDevices } = await supabase
      .from('devices')
      .select('id, source_id, device_name, status, last_seen')
      .in('source_id', sourceIds)

    const widgets = []

    for (const cfg of configs) {
      const src = sources.find((s) => s.id === cfg.source_id)
      if (!src) continue

      const srcEvents = (events || []).filter((e) => e.source_id === src.id)
      const threshold = (src.metadata as Record<string, unknown>)?.threshold as number || 10

      const tempEvent = srcEvents.find(
        (e) =>
          e.event_type === 'TEMP_NORMAL' ||
          e.event_type === 'HIGH_TEMP' ||
          (e.event_type === 'heartbeat' && ((e.payload as Record<string, unknown>)?.temperature || (e.payload as Record<string, unknown>)?.lastTemperature))
      )

      const currentTemp = tempEvent
        ? (((tempEvent.payload as Record<string, unknown>)?.temperature as number) ?? ((tempEvent.payload as Record<string, unknown>)?.lastTemperature as number) ?? null)
        : null

      const currentHumid = tempEvent
        ? (((tempEvent.payload as Record<string, unknown>)?.humidity as number) ?? ((tempEvent.payload as Record<string, unknown>)?.lastHumidity as number) ?? null)
        : null

      const todayEvents = srcEvents.filter(
        (e) => new Date(e.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok' }) === todayStr
      )

      const dailyReport = srcEvents.find(
        (e) =>
          e.event_type === 'DAILY_REPORT' &&
          new Date(e.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok' }) === todayStr
      )

      const todayTemps = todayEvents
        .map((e) => ((e.payload as Record<string, unknown>)?.temperature as number) ?? ((e.payload as Record<string, unknown>)?.lastTemperature as number))
        .filter((t) => typeof t === 'number')

      const realtimeMax = todayTemps.length > 0 ? Math.max(...todayTemps) : null
      const realtimeMin = todayTemps.length > 0 ? Math.min(...todayTemps) : null
      const realtimeAvg = todayTemps.length > 0 ? todayTemps.reduce((a, b) => a + b, 0) / todayTemps.length : null

      const device = (latestDevices || []).find((d) => d.source_id === src.id)

      widgets.push({
        sourceId: src.id,
        sourceName: cfg.display_name || src.name,
        currentTemp: cfg.show_temperature ? currentTemp : null,
        currentHumid: cfg.show_humidity ? currentHumid : null,
        todayMax: cfg.show_min_max ? (dailyReport ? ((dailyReport.payload as Record<string, unknown>)?.maxTemp as number) ?? realtimeMax : realtimeMax) : null,
        todayMin: cfg.show_min_max ? (dailyReport ? ((dailyReport.payload as Record<string, unknown>)?.minTemp as number) ?? realtimeMin : realtimeMin) : null,
        todayAvg: cfg.show_avg ? (dailyReport ? ((dailyReport.payload as Record<string, unknown>)?.avgTemp as number) ?? realtimeAvg : realtimeAvg) : null,
        threshold,
        deviceStatus: device?.status ?? 'unknown',
        showChart: cfg.show_chart ?? true,
      })
    }

    res.json({ widgets })
  })

  app.get('/public/iotcenter/:orgSlug/temperature', async (req: Request, res: Response) => {
    const { orgSlug } = req.params

    const { data: org } = await supabase
      .from('organizations')
      .select('id, name, public_slug, public_enabled')
      .eq('public_slug', orgSlug)
      .single()

    if (!org || !org.public_enabled) {
      res.status(404).json({ error: 'Organization not found or public page not enabled' })
      return
    }

    const now = new Date()
    const todayStr = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok' })
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const { data: configs } = await supabase
      .from('public_configs')
      .select('source_id, display_name, show_temperature, show_humidity, show_min_max, show_avg, show_chart, display_order')
      .eq('enabled', true)
      .order('display_order')

    if (!configs || configs.length === 0) {
      res.json({ widgets: [], orgName: org.name })
      return
    }

    const sourceIds = configs.map((c) => c.source_id)

    const { data: sources } = await supabase
      .from('sources')
      .select('id, name, metadata, active, organization_id')
      .in('id', sourceIds)
      .eq('active', true)
      .eq('organization_id', org.id)

    if (!sources || sources.length === 0) {
      res.json({ widgets: [], orgName: org.name })
      return
    }

    const filteredSourceIds = sources.map((s) => s.id)

    const { data: events } = await supabase
      .from('events')
      .select('source_id, event_type, level, payload, created_at')
      .in('source_id', filteredSourceIds)
      .gte('created_at', oneDayAgo.toISOString())
      .order('created_at', { ascending: false })

    const { data: latestDevices } = await supabase
      .from('devices')
      .select('id, source_id, device_name, status, last_seen')
      .in('source_id', filteredSourceIds)

    const widgets = []

    for (const cfg of configs) {
      const src = sources.find((s) => s.id === cfg.source_id)
      if (!src) continue

      const srcEvents = (events || []).filter((e) => e.source_id === src.id)
      const threshold = (src.metadata as Record<string, unknown>)?.threshold as number || 10

      const tempEvent = srcEvents.find(
        (e) =>
          e.event_type === 'TEMP_NORMAL' ||
          e.event_type === 'HIGH_TEMP' ||
          (e.event_type === 'heartbeat' && ((e.payload as Record<string, unknown>)?.temperature || (e.payload as Record<string, unknown>)?.lastTemperature))
      )

      const currentTemp = tempEvent
        ? (((tempEvent.payload as Record<string, unknown>)?.temperature as number) ?? ((tempEvent.payload as Record<string, unknown>)?.lastTemperature as number) ?? null)
        : null

      const currentHumid = tempEvent
        ? (((tempEvent.payload as Record<string, unknown>)?.humidity as number) ?? ((tempEvent.payload as Record<string, unknown>)?.lastHumidity as number) ?? null)
        : null

      const todayEvents = srcEvents.filter(
        (e) => new Date(e.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok' }) === todayStr
      )

      const dailyReport = srcEvents.find(
        (e) =>
          e.event_type === 'DAILY_REPORT' &&
          new Date(e.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok' }) === todayStr
      )

      const todayTemps = todayEvents
        .map((e) => ((e.payload as Record<string, unknown>)?.temperature as number) ?? ((e.payload as Record<string, unknown>)?.lastTemperature as number))
        .filter((t) => typeof t === 'number')

      const realtimeMax = todayTemps.length > 0 ? Math.max(...todayTemps) : null
      const realtimeMin = todayTemps.length > 0 ? Math.min(...todayTemps) : null
      const realtimeAvg = todayTemps.length > 0 ? todayTemps.reduce((a, b) => a + b, 0) / todayTemps.length : null

      const device = (latestDevices || []).find((d) => d.source_id === src.id)

      widgets.push({
        sourceId: src.id,
        sourceName: cfg.display_name || src.name,
        currentTemp: cfg.show_temperature ? currentTemp : null,
        currentHumid: cfg.show_humidity ? currentHumid : null,
        todayMax: cfg.show_min_max ? (dailyReport ? ((dailyReport.payload as Record<string, unknown>)?.maxTemp as number) ?? realtimeMax : realtimeMax) : null,
        todayMin: cfg.show_min_max ? (dailyReport ? ((dailyReport.payload as Record<string, unknown>)?.minTemp as number) ?? realtimeMin : realtimeMin) : null,
        todayAvg: cfg.show_avg ? (dailyReport ? ((dailyReport.payload as Record<string, unknown>)?.avgTemp as number) ?? realtimeAvg : realtimeAvg) : null,
        threshold,
        deviceStatus: device?.status ?? 'unknown',
        showChart: cfg.show_chart ?? true,
      })
    }

    res.json({ widgets, orgName: org.name })
  })

  app.get('/public/iotcenter/temperature/:sourceId/chart', async (req: Request, res: Response) => {
    const { sourceId } = req.params
    const range = (req.query.range as string) || '1d'
    if (!['1d', '3d', '7d', '30d'].includes(range)) {
      res.status(400).json({ error: 'Invalid range' })
      return
    }

    const { data: config } = await supabase
      .from('public_configs')
      .select('source_id, show_chart, enabled')
      .eq('source_id', sourceId)
      .eq('enabled', true)
      .single()

    if (!config) {
      res.status(404).json({ error: 'Source not found or not enabled' })
      return
    }

    const since = new Date()
    switch (range) {
      case '3d': since.setDate(since.getDate() - 3); break
      case '7d': since.setDate(since.getDate() - 7); break
      case '30d': since.setDate(since.getDate() - 30); break
      default: since.setDate(since.getDate() - 1)
    }

    const { data: events } = await supabase
      .from('events')
      .select('created_at, payload')
      .eq('source_id', sourceId)
      .in('event_type', ['TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat'])
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })

    if (!events || events.length === 0) {
      res.json({ data: [] })
      return
    }

    const fmt = range === '1d'
      ? (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
      : (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })

    const chartData = events
      .map((e) => {
        const p = e.payload as Record<string, unknown>
        const t = (p.temperature as number) ?? (p.lastTemperature as number)
        if (typeof t !== 'number') return null
        const item: { timestamp: string; temperature: number; humidity?: number } = {
          timestamp: fmt(new Date(e.created_at)),
          temperature: t,
        }
        const h = (p.humidity as number) ?? (p.lastHumidity as number)
        if (typeof h === 'number' && h > 0) item.humidity = h
        return item
      })
      .filter(Boolean) as { timestamp: string; temperature: number; humidity?: number }[]

    res.json({ data: chartData })
  })

  app.get('/public/iotcenter/:orgSlug/temperature/:sourceId/chart', async (req: Request, res: Response) => {
    const { orgSlug, sourceId } = req.params
    const range = (req.query.range as string) || '1d'
    if (!['1d', '3d', '7d', '30d'].includes(range)) {
      res.status(400).json({ error: 'Invalid range' })
      return
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('id, public_enabled')
      .eq('public_slug', orgSlug)
      .single()

    if (!org || !org.public_enabled) {
      res.status(404).json({ error: 'Organization not found or public page not enabled' })
      return
    }

    const { data: config } = await supabase
      .from('public_configs')
      .select('source_id, show_chart, enabled')
      .eq('source_id', sourceId)
      .eq('enabled', true)
      .single()

    if (!config) {
      res.status(404).json({ error: 'Source not found or not enabled' })
      return
    }

    const { data: source } = await supabase
      .from('sources')
      .select('id, organization_id')
      .eq('id', sourceId)
      .eq('organization_id', org.id)
      .single()

    if (!source) {
      res.status(404).json({ error: 'Source not found in this organization' })
      return
    }

    const since = new Date()
    switch (range) {
      case '3d': since.setDate(since.getDate() - 3); break
      case '7d': since.setDate(since.getDate() - 7); break
      case '30d': since.setDate(since.getDate() - 30); break
      default: since.setDate(since.getDate() - 1)
    }

    const { data: events } = await supabase
      .from('events')
      .select('created_at, payload')
      .eq('source_id', sourceId)
      .in('event_type', ['TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat'])
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })

    if (!events || events.length === 0) {
      res.json({ data: [] })
      return
    }

    const fmt = range === '1d'
      ? (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
      : (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })

    const chartData = events
      .map((e) => {
        const p = e.payload as Record<string, unknown>
        const t = (p.temperature as number) ?? (p.lastTemperature as number)
        if (typeof t !== 'number') return null
        const item: { timestamp: string; temperature: number; humidity?: number } = {
          timestamp: fmt(new Date(e.created_at)),
          temperature: t,
        }
        const h = (p.humidity as number) ?? (p.lastHumidity as number)
        if (typeof h === 'number' && h > 0) item.humidity = h
        return item
      })
      .filter(Boolean) as { timestamp: string; temperature: number; humidity?: number }[]

    res.json({ data: chartData })
  })
}
