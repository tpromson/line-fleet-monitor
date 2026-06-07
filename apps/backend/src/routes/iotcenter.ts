import type { Express, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { supabase } from '../lib/supabase.js'
import { requireApiKey } from '../lib/api-key-auth.js'
import { requireSuperAdmin } from '../lib/auth.js'

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.PUBLIC_RATE_LIMIT_MAX) || 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})

const BANGKOK_TZ = 'Asia/Bangkok'
const OUTLIER_RECONNECT_GAP_MS = parseInt(process.env.OUTLIER_RECONNECT_GAP_MS || '20000', 10)
const OUTLIER_RECONNECT_TEMP = Number(process.env.OUTLIER_RECONNECT_TEMP || 25)
const OUTLIER_RECONNECT_TOLERANCE = 0.1

type ConfigRow = {
  source_id: string
  display_name: string | null
  show_temperature: boolean
  show_humidity: boolean
  show_min_max: boolean
  show_avg: boolean
  show_chart: boolean | null
}

type SourceRow = {
  id: string
  name: string
  metadata: unknown
  organization_id?: string
}

type EventRow = {
  source_id: string
  event_type: string
  level: string | null
  payload: unknown
  created_at: string
}

type DeviceRow = {
  id: string
  source_id: string
  device_name: string
  status: string
  last_seen: string | null
}

type Widget = {
  sourceId: string
  sourceName: string
  currentTemp: number | null
  currentHumid: number | null
  todayMax: number | null
  todayMin: number | null
  todayAvg: number | null
  threshold: number
  deviceStatus: string
  showChart: boolean
}

function getTodayStrInBangkok(now: Date = new Date()): string {
  return now.toLocaleDateString('en-GB', { timeZone: BANGKOK_TZ })
}

function toBangkokDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: BANGKOK_TZ })
}

function readNumber(payload: unknown, ...keys: string[]): number | null {
  const obj = payload as Record<string, unknown> | null
  if (!obj) return null
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'number') return v
  }
  return null
}

function hasTemperature(payload: unknown): boolean {
  const obj = payload as Record<string, unknown> | null
  if (!obj) return false
  return typeof obj.temperature === 'number' || typeof obj.lastTemperature === 'number'
}

function isReconnectOutlierTemp(t: number): boolean {
  return Math.abs(t - OUTLIER_RECONNECT_TEMP) <= OUTLIER_RECONNECT_TOLERANCE
}

async function logOutlier(params: {
  sourceId: string
  deviceId: string | null
  eventType: string
  reason: string
  payload: unknown
}): Promise<void> {
  const p = params.payload as Record<string, unknown> | null
  const temperature = readNumber(p, 'temperature', 'lastTemperature')
  const humidity = readNumber(p, 'humidity', 'lastHumidity')

  const { error } = await supabase.from('outlier_logs').insert({
    source_id: params.sourceId,
    device_id: params.deviceId,
    event_type: params.eventType,
    reason: params.reason,
    temperature,
    humidity,
    payload: params.payload || {},
  })

  if (error) {
    console.error('[iotcenter] Failed to log outlier:', error.message)
  } else {
    console.log(
      `[iotcenter] Filtered outlier: ${params.reason} temp=${temperature} device=${params.deviceId ?? 'n/a'}`
    )
  }
}

async function wasDeviceRecentlyOffline(deviceId: string, sourceId: string): Promise<boolean> {
  const { data: device } = await supabase
    .from('devices')
    .select('status, last_seen')
    .eq('id', deviceId)
    .eq('source_id', sourceId)
    .maybeSingle()

  if (!device || !device.last_seen) return true
  if (device.status === 'offline') return true
  const gap = Date.now() - new Date(device.last_seen).getTime()
  return gap > OUTLIER_RECONNECT_GAP_MS
}

function isOutlierEvent(events: EventRow[], target: EventRow): boolean {
  if (!hasTemperature(target.payload)) return false
  const temp = readNumber(target.payload, 'temperature', 'lastTemperature')
  if (temp === null || !isReconnectOutlierTemp(temp)) return false

  const targetTime = new Date(target.created_at).getTime()
  let prevTime: number | null = null
  for (const e of events) {
    if (e === target) continue
    const t = new Date(e.created_at).getTime()
    if (t < targetTime && (prevTime === null || t > prevTime)) {
      prevTime = t
    }
  }
  return prevTime === null || targetTime - prevTime > OUTLIER_RECONNECT_GAP_MS
}

function filterOutlierEvents(events: EventRow[]): EventRow[] {
  return events.filter((e) => !isOutlierEvent(events, e))
}

function findLatestTempEvent(events: EventRow[]): EventRow | undefined {
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const isTempEvent =
      e.event_type === 'TEMP_NORMAL' ||
      e.event_type === 'HIGH_TEMP' ||
      (e.event_type === 'heartbeat' && hasTemperature(e.payload))
    if (!isTempEvent) continue

    const temp = readNumber(e.payload, 'temperature', 'lastTemperature')
    if (temp !== null && isReconnectOutlierTemp(temp)) {
      const next = events[i + 1]
      const prevTime = next ? new Date(next.created_at).getTime() : null
      const currTime = new Date(e.created_at).getTime()
      const isFirstAfterGap = prevTime === null || currTime - prevTime > OUTLIER_RECONNECT_GAP_MS
      if (isFirstAfterGap) continue
    }

    return e
  }
  return undefined
}

function buildWidgets(
  configs: ConfigRow[],
  sources: SourceRow[],
  events: EventRow[],
  devices: DeviceRow[]
): Widget[] {
  const todayStr = getTodayStrInBangkok()
  const widgets: Widget[] = []

  for (const cfg of configs) {
    const src = sources.find((s) => s.id === cfg.source_id)
    if (!src) continue

    const srcEvents = events.filter((e) => e.source_id === src.id)
    const threshold = readNumber(src.metadata, 'threshold') ?? 10

    const tempEvent = findLatestTempEvent(srcEvents)
    const currentTemp = tempEvent ? readNumber(tempEvent.payload, 'temperature', 'lastTemperature') : null
    const currentHumid = tempEvent ? readNumber(tempEvent.payload, 'humidity', 'lastHumidity') : null

    const todayEvents = srcEvents.filter((e) => toBangkokDateStr(e.created_at) === todayStr)
    const filteredTodayEvents = filterOutlierEvents(todayEvents)
    const dailyReport = srcEvents.find(
      (e) => e.event_type === 'DAILY_REPORT' && toBangkokDateStr(e.created_at) === todayStr
    )

    const todayTemps = filteredTodayEvents
      .map((e) => readNumber(e.payload, 'temperature', 'lastTemperature'))
      .filter((t): t is number => typeof t === 'number')

    const realtimeMax = todayTemps.length > 0 ? Math.max(...todayTemps) : null
    const realtimeMin = todayTemps.length > 0 ? Math.min(...todayTemps) : null
    const realtimeAvg = todayTemps.length > 0 ? todayTemps.reduce((a, b) => a + b, 0) / todayTemps.length : null

    const device = devices.find((d) => d.source_id === src.id)

    widgets.push({
      sourceId: src.id,
      sourceName: cfg.display_name || src.name,
      currentTemp: cfg.show_temperature ? currentTemp : null,
      currentHumid: cfg.show_humidity ? currentHumid : null,
      todayMax: cfg.show_min_max ? (readNumber(dailyReport?.payload, 'maxTemp') ?? realtimeMax) : null,
      todayMin: cfg.show_min_max ? (readNumber(dailyReport?.payload, 'minTemp') ?? realtimeMin) : null,
      todayAvg: cfg.show_avg ? (readNumber(dailyReport?.payload, 'avgTemp') ?? realtimeAvg) : null,
      threshold,
      deviceStatus: device?.status ?? 'unknown',
      showChart: cfg.show_chart ?? true,
    })
  }

  return widgets
}

type ChartPoint = { timestamp: string; temperature: number; humidity?: number }

function rangeToSince(range: string): Date {
  const since = new Date()
  const days = range === '3d' ? 3 : range === '7d' ? 7 : range === '30d' ? 30 : 1
  since.setDate(since.getDate() - days)
  return since
}

function buildChartData(events: { created_at: string; payload: unknown }[], range: string): ChartPoint[] {
  const fmt: (d: Date) => string = range === '1d'
    ? (d) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: BANGKOK_TZ })
    : (d) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: BANGKOK_TZ })

  const filtered = filterOutlierEvents(events as EventRow[])
  const out: ChartPoint[] = []
  for (const e of filtered) {
    const t = readNumber(e.payload, 'temperature', 'lastTemperature')
    if (typeof t !== 'number') continue
    const item: ChartPoint = { timestamp: fmt(new Date(e.created_at)), temperature: t }
    const h = readNumber(e.payload, 'humidity', 'lastHumidity')
    if (typeof h === 'number' && h > 0) item.humidity = h
    out.push(item)
  }
  return out
}

async function fetchWidgetData(sourceIds: string[]) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [configsRes, sourcesRes, eventsRes, devicesRes] = await Promise.all([
    supabase
      .from('public_configs')
      .select('source_id, display_name, show_temperature, show_humidity, show_min_max, show_avg, show_chart, display_order')
      .eq('enabled', true)
      .order('display_order'),
    supabase.from('sources').select('id, name, metadata, active').in('id', sourceIds).eq('active', true),
    supabase
      .from('events')
      .select('source_id, event_type, level, payload, created_at')
      .in('source_id', sourceIds)
      .gte('created_at', oneDayAgo.toISOString())
      .order('created_at', { ascending: false }),
    supabase.from('devices').select('id, source_id, device_name, status, last_seen').in('source_id', sourceIds),
  ])

  return {
    configs: (configsRes.data ?? []) as ConfigRow[],
    sources: (sourcesRes.data ?? []) as SourceRow[],
    events: (eventsRes.data ?? []) as EventRow[],
    devices: (devicesRes.data ?? []) as DeviceRow[],
  }
}

export function registerIotcenterRoutes(app: Express) {
  app.post('/api/iotcenter/events', async (req: Request, res: Response) => {
    const source = await requireApiKey(req, res)
    if (!source) return

    const { device_id, event_type, level, message, payload } = req.body

    if (!event_type) {
      res.status(400).json({ error: 'event_type is required' })
      return
    }

    if (device_id && hasTemperature(payload)) {
      const temp = readNumber(payload, 'temperature', 'lastTemperature')
      if (temp !== null && isReconnectOutlierTemp(temp)) {
        const recentlyOffline = await wasDeviceRecentlyOffline(device_id, source.sourceId)
        if (recentlyOffline) {
          await logOutlier({
            sourceId: source.sourceId,
            deviceId: device_id,
            eventType: event_type,
            reason: 'reconnect_25c',
            payload,
          })
          res.status(200).json({ status: 'filtered_outlier', reason: 'reconnect_25c' })
          return
        }
      }
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
      .select('id, last_seen, status')
      .eq('source_id', source.sourceId)
      .ilike('device_name', device_name)
      .maybeSingle()

    if (existing) {
      const isReconnect =
        existing.status === 'offline' ||
        !existing.last_seen ||
        Date.now() - new Date(existing.last_seen).getTime() > OUTLIER_RECONNECT_GAP_MS

      let filtered = false
      if (isReconnect && hasTemperature(metadata)) {
        const temp = readNumber(metadata, 'temperature', 'lastTemperature')
        if (temp !== null && isReconnectOutlierTemp(temp)) {
          await logOutlier({
            sourceId: source.sourceId,
            deviceId: existing.id,
            eventType: 'heartbeat',
            reason: 'reconnect_25c',
            payload: metadata,
          })
          filtered = true
        }
      }

      await supabase
        .from('devices')
        .update({ status: 'online', last_seen: now, updated_at: now, ...(metadata ? { metadata } : {}) })
        .eq('id', existing.id)

      if (filtered) {
        res.status(200).json({ status: 'filtered_outlier', reason: 'reconnect_25c' })
        return
      }

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

  app.get('/public/iotcenter/temperature', publicLimiter, async (_req: Request, res: Response) => {
    const { data: configs } = await supabase
      .from('public_configs')
      .select('source_id')
      .eq('enabled', true)
      .order('display_order')

    if (!configs || configs.length === 0) {
      res.json({ widgets: [] })
      return
    }

    const sourceIds = configs.map((c) => c.source_id)
    const { configs: fullConfigs, sources, events, devices } = await fetchWidgetData(sourceIds)
    const widgets = buildWidgets(fullConfigs, sources, events, devices)
    res.json({ widgets })
  })

  app.get('/public/iotcenter/:orgSlug/temperature', publicLimiter, async (req: Request, res: Response) => {
    const { orgSlug } = req.params

    const { data: org } = await supabase
      .from('organizations')
      .select('id, name, public_enabled')
      .eq('public_slug', orgSlug)
      .single()

    if (!org || !org.public_enabled) {
      res.status(404).json({ error: 'Organization not found or public page not enabled' })
      return
    }

    const { data: configs } = await supabase
      .from('public_configs')
      .select('source_id')
      .eq('enabled', true)
      .order('display_order')

    if (!configs || configs.length === 0) {
      res.json({ widgets: [], orgName: org.name })
      return
    }

    const candidateIds = configs.map((c) => c.source_id)
    const { data: orgSources } = await supabase
      .from('sources')
      .select('id')
      .in('id', candidateIds)
      .eq('active', true)
      .eq('organization_id', org.id)

    if (!orgSources || orgSources.length === 0) {
      res.json({ widgets: [], orgName: org.name })
      return
    }

    const sourceIds = orgSources.map((s) => s.id)
    const { configs: fullConfigs, sources, events, devices } = await fetchWidgetData(sourceIds)
    const widgets = buildWidgets(fullConfigs, sources, events, devices)
    res.json({ widgets, orgName: org.name })
  })

  app.get('/public/iotcenter/temperature/:sourceId/chart', publicLimiter, async (req: Request, res: Response) => {
    const { sourceId } = req.params
    const range = (req.query.range as string) || '1d'
    if (!['1d', '3d', '7d', '30d'].includes(range)) {
      res.status(400).json({ error: 'Invalid range' })
      return
    }

    const { data: config } = await supabase
      .from('public_configs')
      .select('source_id')
      .eq('source_id', sourceId)
      .eq('enabled', true)
      .single()

    if (!config) {
      res.status(404).json({ error: 'Source not found or not enabled' })
      return
    }

    const { data: events } = await supabase
      .from('events')
      .select('created_at, payload')
      .eq('source_id', sourceId)
      .in('event_type', ['TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat'])
      .gte('created_at', rangeToSince(range).toISOString())
      .order('created_at', { ascending: true })

    res.json({ data: buildChartData(events ?? [], range) })
  })

  app.get('/public/iotcenter/:orgSlug/temperature/:sourceId/chart', publicLimiter, async (req: Request, res: Response) => {
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

    const { data: source } = await supabase
      .from('sources')
      .select('id')
      .eq('id', sourceId)
      .eq('organization_id', org.id)
      .single()

    if (!source) {
      res.status(404).json({ error: 'Source not found in this organization' })
      return
    }

    const { data: config } = await supabase
      .from('public_configs')
      .select('source_id')
      .eq('source_id', sourceId)
      .eq('enabled', true)
      .single()

    if (!config) {
      res.status(404).json({ error: 'Source not found or not enabled' })
      return
    }

    const { data: events } = await supabase
      .from('events')
      .select('created_at, payload')
      .eq('source_id', sourceId)
      .in('event_type', ['TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat'])
      .gte('created_at', rangeToSince(range).toISOString())
      .order('created_at', { ascending: true })

    res.json({ data: buildChartData(events ?? [], range) })
  })
}
