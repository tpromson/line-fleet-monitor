import type { Express, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { supabase } from '../lib/supabase.js'
import { requireApiKey } from '../lib/api-key-auth.js'
import { requireSuperAdmin } from '../lib/auth.js'
import { sendMophNotify } from '../lib/moph-notify.js'

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

// Absolute sanity bounds — no monitored fridge/freezer/storage room legitimately
// reads below -40°C or above 60°C. Separate from the narrow ~25°C reconnect-glitch
// filter above; catches generic sensor garbage (e.g. a DHT22 read error reporting
// 85°C). Mirrored client-side in apps/web/src/lib/temperature.ts since the main
// dashboard queries Supabase directly and never goes through these routes.
const MIN_PLAUSIBLE_TEMP = Number(process.env.MIN_PLAUSIBLE_TEMP || -40)
const MAX_PLAUSIBLE_TEMP = Number(process.env.MAX_PLAUSIBLE_TEMP || 60)

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

function formatBangkokDateTime(value: string | Date): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('th-TH', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
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

function isImplausibleTemp(t: number): boolean {
  return t < MIN_PLAUSIBLE_TEMP || t > MAX_PLAUSIBLE_TEMP
}

function isTemperatureEvent(eventType: string): boolean {
  return ['HIGH_TEMP', 'LOW_TEMP', 'TEMP_NORMAL', 'TEMP_RECOVERY'].includes(eventType)
}

function isSensorOfflineEvent(eventType: string): boolean {
  return eventType === 'SENSOR OFFLINE' || eventType === 'SENSOR_OFFLINE'
}

function isFreshSensorRecoveryEvent(eventType: string): boolean {
  return eventType === 'heartbeat' ||
    eventType === 'TEMP_NORMAL' ||
    eventType === 'HIGH_TEMP' ||
    eventType === 'LOW_TEMP' ||
    eventType === 'SENSOR_RECOVERY'
}

async function getPreviousTemperatureEventType(sourceId: string, deviceId: string | null): Promise<string | null> {
  const baseQuery = supabase
    .from('events')
    .select('event_type')
    .eq('source_id', sourceId)

  const query = deviceId ? baseQuery.eq('device_id', deviceId) : baseQuery
  const { data } = await query
    .in('event_type', ['HIGH_TEMP', 'LOW_TEMP', 'TEMP_NORMAL', 'TEMP_RECOVERY'])
    .order('created_at', { ascending: false })
    .limit(1)

  return data?.[0]?.event_type ?? null
}

async function notifyTemperatureTransition(params: {
  eventType: string
  previousEventType: string | null
  organizationId?: string
  deviceName?: string
  message?: string
  payload: unknown
}): Promise<void> {
  if (!isTemperatureEvent(params.eventType)) return

  const temperature = readNumber(params.payload, 'temperature', 'lastTemperature')
  if (temperature === null) return

  const isAbnormal = params.eventType === 'HIGH_TEMP' || params.eventType === 'LOW_TEMP'
  const wasAbnormal = params.previousEventType === 'HIGH_TEMP' || params.previousEventType === 'LOW_TEMP'
  const shouldNotify = isAbnormal
    ? params.previousEventType !== params.eventType
    : wasAbnormal

  if (!shouldNotify) return

  const threshold = readNumber(params.payload, 'threshold')
  const isHigh = params.eventType === 'HIGH_TEMP'
  const isLow = params.eventType === 'LOW_TEMP'
  const detectedAt = `ตรวจพบเมื่อ: ${formatBangkokDateTime(new Date()) || '-'}`
  const text = isHigh
    ? [
        '⚠️ แจ้งเตือนอุณหภูมิสูง',
        detectedAt,
        '---------------------------',
        `📍 ${params.deviceName || 'ไม่ระบุ'}`,
        `└ อุณหภูมิ: ${temperature.toFixed(1)} °C`,
        threshold === null ? null : `└ เกณฑ์: ${threshold.toFixed(1)} °C`,
      ].filter(Boolean).join('\n')
    : isLow
      ? [
          '❄️ แจ้งเตือนอุณหภูมิต่ำ',
          detectedAt,
          '---------------------------',
          `📍 ${params.deviceName || 'ไม่ระบุ'}`,
          `└ อุณหภูมิ: ${temperature.toFixed(1)} °C`,
          threshold === null ? null : `└ เกณฑ์ขั้นต่ำ: ${threshold.toFixed(1)} °C`,
        ].filter(Boolean).join('\n')
    : [
        '✅ แจ้งเตือนอุณหภูมิกลับสู่ปกติ',
        detectedAt,
        '---------------------------',
        `📍 ${params.deviceName || 'ไม่ระบุ'}`,
        `└ อุณหภูมิ: ${temperature.toFixed(1)} °C`,
      ].join('\n')

  const result = await sendMophNotify(text, params.organizationId)
  if (result.status === 'failed') {
    console.error('[iotcenter] Temperature MOPH Notify failed:', result.reason)
  }
}

async function notifySensorOffline(params: {
  organizationId?: string
  deviceName?: string
  message?: string
  payload: unknown
}): Promise<void> {
  const minutes = readNumber(params.payload, 'minutesSinceLastContact')
  const lastContact = (params.payload as Record<string, unknown> | null)?.lastContact
  const formattedLastContact = typeof lastContact === 'string' ? formatBangkokDateTime(lastContact) : null
  const details = [
    minutes === null ? null : `└ ไม่ได้รับข้อมูลเกิน ${Math.round(minutes)} นาที`,
    formattedLastContact ? `└ ล่าสุด: ${formattedLastContact} น.` : null,
  ].filter(Boolean)
  if (details.length === 0 && params.message) details.push(`└ ${params.message}`)
  const text = [
    '🚨 แจ้งเตือน Sensor Offline',
    `ตรวจพบเมื่อ: ${formatBangkokDateTime(new Date()) || '-'}`,
    'จำนวน: 1 อุปกรณ์',
    '---------------------------',
    '',
    `📍 ${params.deviceName || 'ไม่ระบุ'}`,
    ...details,
  ].filter((line): line is string => line !== null).join('\n')

  const result = await sendMophNotify(text, params.organizationId)
  if (result.status === 'failed') {
    console.error('[iotcenter] Sensor offline MOPH Notify failed:', result.reason)
  }
}

async function notifySensorRecovery(params: {
  organizationId?: string
  deviceName?: string
  message?: string
  payload: unknown
}): Promise<void> {
  const temperature = readNumber(params.payload, 'temperature', 'lastTemperature')
  const text = [
    '✅ แจ้งเตือน Sensor กลับมา Online',
    `ตรวจพบเมื่อ: ${formatBangkokDateTime(new Date()) || '-'}`,
    'จำนวน: 1 อุปกรณ์',
    '---------------------------',
    '',
    `📍 ${params.deviceName || 'ไม่ระบุ'}`,
    temperature === null ? '└ เริ่มส่งข้อมูลใหม่แล้ว' : `└ อุณหภูมิล่าสุด: ${temperature.toFixed(1)} °C`,
    `└ ${params.message || 'Sensor กลับมาทำงานปกติ'}`,
  ].filter((line): line is string => line !== null).join('\n')

  const result = await sendMophNotify(text, params.organizationId)
  if (result.status === 'failed') {
    console.error('[iotcenter] Sensor recovery MOPH Notify failed:', result.reason)
  }
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
  if (temp === null) return false
  if (isImplausibleTemp(temp)) return true
  if (!isReconnectOutlierTemp(temp)) return false

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
    if (temp !== null && isImplausibleTemp(temp)) continue
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

    const { device_id, device_name, event_type, level, message, payload } = req.body

    if (!event_type) {
      res.status(400).json({ error: 'event_type is required' })
      return
    }

    let resolvedDeviceId = device_id || null
    if (!resolvedDeviceId && device_name) {
      const { data: dev } = await supabase
        .from('devices')
        .select('id')
        .eq('source_id', source.sourceId)
        .ilike('device_name', device_name)
        .maybeSingle()
      if (dev) resolvedDeviceId = dev.id
    }

    if (hasTemperature(payload)) {
      const temp = readNumber(payload, 'temperature', 'lastTemperature')
      if (temp !== null && isImplausibleTemp(temp)) {
        await logOutlier({
          sourceId: source.sourceId,
          deviceId: resolvedDeviceId,
          eventType: event_type,
          reason: 'implausible_value',
          payload,
        })
        res.status(200).json({ status: 'filtered_outlier', reason: 'implausible_value' })
        return
      }
      if (resolvedDeviceId && temp !== null && isReconnectOutlierTemp(temp)) {
        const recentlyOffline = await wasDeviceRecentlyOffline(resolvedDeviceId, source.sourceId)
        if (recentlyOffline) {
          await logOutlier({
            sourceId: source.sourceId,
            deviceId: resolvedDeviceId,
            eventType: event_type,
            reason: 'reconnect_25c',
            payload,
          })
          res.status(200).json({ status: 'filtered_outlier', reason: 'reconnect_25c' })
          return
        }
      }
    }

    const previousTemperatureEventType = process.env.MOPH_NOTIFY_ENABLED === 'true' && isTemperatureEvent(event_type)
      ? await getPreviousTemperatureEventType(source.sourceId, resolvedDeviceId)
      : null

    let wasOffline = false
    if (
      process.env.MOPH_NOTIFY_ENABLED === 'true' &&
      (isSensorOfflineEvent(event_type) || isFreshSensorRecoveryEvent(event_type)) &&
      resolvedDeviceId
    ) {
      const { data: deviceBefore } = await supabase
        .from('devices')
        .select('status, metadata')
        .eq('id', resolvedDeviceId)
        .eq('source_id', source.sourceId)
        .maybeSingle()
      const metadataBefore = (deviceBefore?.metadata as Record<string, unknown>) || {}
      wasOffline = deviceBefore?.status === 'offline' || metadataBefore.sensor_status === 'offline'
    }

    const { error } = await supabase.from('events').insert({
      source_id: source.sourceId,
      device_id: resolvedDeviceId,
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

    const nowTs = new Date().toISOString()

    if (event_type === 'heartbeat') {
      let resolvedId = device_id
      if (!resolvedId && device_name) {
        const { data: dev } = await supabase
          .from('devices')
          .select('id')
          .eq('source_id', source.sourceId)
          .ilike('device_name', device_name)
          .maybeSingle()
        if (dev) resolvedId = dev.id
      }
      if (resolvedId) {
        // Same policy as /api/iotcenter/heartbeat: only advance last_seen when this
        // heartbeat carries a valid, plausible temperature — a bare/empty payload is
        // not proof the sensor pipeline is alive.
        const temp = readNumber(payload, 'temperature', 'lastTemperature')
        const hasValidTemp = temp !== null && !isImplausibleTemp(temp) && !isReconnectOutlierTemp(temp)
        const { data: dev } = await supabase
          .from('devices')
          .select('last_seen, status, metadata')
          .eq('id', resolvedId)
          .maybeSingle()
        const existingMeta = (dev?.metadata as Record<string, unknown>) || {}
        const sensorOffline = dev?.status === 'offline' || existingMeta.sensor_status === 'offline'
        await supabase
          .from('devices')
          .update({
            status: hasValidTemp ? 'online' : (sensorOffline ? 'offline' : 'online'),
            last_seen: hasValidTemp ? nowTs : (dev?.last_seen ?? nowTs),
            updated_at: nowTs,
            metadata: { ...existingMeta, sensor_status: hasValidTemp ? 'online' : (sensorOffline ? 'offline' : (existingMeta.sensor_status ?? 'online')) },
          })
          .eq('id', resolvedId)
          .eq('source_id', source.sourceId)

        if (wasOffline && hasValidTemp && process.env.MOPH_NOTIFY_ENABLED === 'true') {
          await notifySensorRecovery({
            organizationId: source.organizationId,
            deviceName: device_name,
            message: 'ได้รับข้อมูลใหม่จาก Sensor แล้ว',
            payload,
          })
        }
      }
    }

    if (['TEMP_NORMAL', 'HIGH_TEMP', 'LOW_TEMP', 'TEMP_RECOVERY', 'SENSOR_RECOVERY'].includes(event_type)) {
      if (resolvedDeviceId) {
        const { data: devData } = await supabase.from('devices').select('metadata').eq('id', resolvedDeviceId).maybeSingle()
        const devMeta = (devData?.metadata as Record<string, unknown>) || {}
        await supabase
          .from('devices')
          .update({ status: 'online', last_seen: nowTs, updated_at: nowTs, metadata: { ...devMeta, sensor_status: 'online' } })
          .eq('id', resolvedDeviceId)
          .eq('source_id', source.sourceId)
      }
    }

    if (process.env.MOPH_NOTIFY_ENABLED === 'true') {
      await notifyTemperatureTransition({
        eventType: event_type,
        previousEventType: previousTemperatureEventType,
        organizationId: source.organizationId,
        deviceName: device_name,
        message,
        payload,
      })
    }

    if (isSensorOfflineEvent(event_type) && resolvedDeviceId) {
      const { data: devData } = await supabase.from('devices').select('metadata').eq('id', resolvedDeviceId).maybeSingle()
      const devMeta = (devData?.metadata as Record<string, unknown>) || {}
      await supabase
        .from('devices')
        .update({ status: 'offline', updated_at: nowTs, metadata: { ...devMeta, sensor_status: 'offline' } })
        .eq('id', resolvedDeviceId)
        .eq('source_id', source.sourceId)

      if (!wasOffline) {
        await notifySensorOffline({
          organizationId: source.organizationId,
          deviceName: device_name,
          message,
          payload,
        })
      }
    }

    if (
      isFreshSensorRecoveryEvent(event_type) &&
      event_type !== 'heartbeat' &&
      resolvedDeviceId &&
      wasOffline &&
      process.env.MOPH_NOTIFY_ENABLED === 'true'
    ) {
      await notifySensorRecovery({
        organizationId: source.organizationId,
        deviceName: device_name,
        message,
        payload,
      })
    }

    if (event_type === 'DEVICE_BOOT' || event_type === 'BOOT_WDT' || event_type === 'BOOT') {
      let resolvedId = device_id
      if (!resolvedId && device_name) {
        const { data: dev } = await supabase
          .from('devices')
          .select('id')
          .eq('source_id', source.sourceId)
          .ilike('device_name', device_name)
          .maybeSingle()
        if (dev) resolvedId = dev.id
      }

      if (resolvedId) {
        const { data: device } = await supabase
          .from('devices')
          .select('metadata')
          .eq('id', resolvedId)
          .single()

        const now = new Date().toISOString()
        const currentMeta = (device?.metadata as Record<string, unknown>) || {}
        const bootCount = ((currentMeta.boot_count as number) || 0) + 1

        await supabase
          .from('devices')
          .update({
            status: 'online',
            last_seen: now,
            updated_at: now,
            metadata: { ...currentMeta, last_boot: now, boot_count: bootCount },
          })
          .eq('id', resolvedId)
          .eq('source_id', source.sourceId)
      }
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
      .select('id, last_seen, status, metadata')
      .eq('source_id', source.sourceId)
      .ilike('device_name', device_name)
      .maybeSingle()

    if (existing) {
      const isReconnect =
        existing.status === 'offline' ||
        !existing.last_seen ||
        Date.now() - new Date(existing.last_seen).getTime() > OUTLIER_RECONNECT_GAP_MS

      let filtered = false
      let filterReason: string | null = null
      if (hasTemperature(metadata)) {
        const temp = readNumber(metadata, 'temperature', 'lastTemperature')
        if (temp !== null && isImplausibleTemp(temp)) {
          await logOutlier({
            sourceId: source.sourceId,
            deviceId: existing.id,
            eventType: 'heartbeat',
            reason: 'implausible_value',
            payload: metadata,
          })
          filtered = true
          filterReason = 'implausible_value'
        } else if (isReconnect && temp !== null && isReconnectOutlierTemp(temp)) {
          await logOutlier({
            sourceId: source.sourceId,
            deviceId: existing.id,
            eventType: 'heartbeat',
            reason: 'reconnect_25c',
            payload: metadata,
          })
          filtered = true
          filterReason = 'reconnect_25c'
        }
      }

      const existingMeta = (existing.metadata as Record<string, unknown>) || {}
      const sensorOffline = existing.status === 'offline' || existingMeta.sensor_status === 'offline'
      const temp = readNumber(metadata, 'temperature', 'lastTemperature')
      const hasValidTemp = temp !== null && !isImplausibleTemp(temp) && !isReconnectOutlierTemp(temp)
      const shouldNotifyRecovery = sensorOffline && hasValidTemp
      const newSensorStatus = hasValidTemp ? 'online' : (sensorOffline ? 'offline' : (existingMeta.sensor_status ?? 'online'))
      const mergedMeta = metadata
        ? { ...existingMeta, ...metadata, sensor_status: newSensorStatus }
        : existingMeta

      // Only advance last_seen when this heartbeat actually proves the sensor pipeline
      // is alive (a valid, plausible temperature reading came with it). A "bare"
      // heartbeat carrying no temperature (e.g. GAS scripts that ping unconditionally
      // at the end of a scheduled check, even right after detecting a stale-data
      // condition) is not proof of anything and must not keep last_seen artificially
      // fresh — otherwise detectOfflineDevices' 35-min threshold never fires no matter
      // how long the actual sensor has been stuck. This protects every source
      // regardless of which GAS script version is deployed to it.
      const nextLastSeen = hasValidTemp ? now : (existing.last_seen ?? now)

      await supabase
        .from('devices')
        .update({
          status: hasValidTemp ? 'online' : (sensorOffline ? existing.status : 'online'),
          last_seen: nextLastSeen,
          updated_at: now,
          metadata: mergedMeta,
        })
        .eq('id', existing.id)

      if (filtered) {
        res.status(200).json({ status: 'filtered_outlier', reason: filterReason })
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

      if (shouldNotifyRecovery && process.env.MOPH_NOTIFY_ENABLED === 'true') {
        await notifySensorRecovery({
          organizationId: source.organizationId,
          deviceName: device_name,
          message: 'ได้รับข้อมูลใหม่จาก Sensor แล้ว',
          payload: metadata,
        })
      }
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

    const { data: recentEvents } = await supabase
      .from('events')
      .select('id, source_id, event_type, level, message, payload, created_at')
      .in('source_id', sourceIds)
      .order('created_at', { ascending: false })
      .limit(50)

    res.json({ widgets, recentEvents: recentEvents ?? [] })
  })

  app.get('/public/iotcenter/:orgSlug/temperature', publicLimiter, async (req: Request, res: Response) => {
    const { orgSlug } = req.params
    const group = req.query.group as string | undefined

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
    let query = supabase
      .from('sources')
      .select('id, metadata')
      .in('id', candidateIds)
      .eq('active', true)
      .eq('organization_id', org.id)

    const { data: orgSources } = await query

    if (!orgSources || orgSources.length === 0) {
      res.json({ widgets: [], orgName: org.name })
      return
    }

    let sourceIds = orgSources.map((s) => s.id)

    if (group) {
      sourceIds = orgSources
        .filter((s) => (s.metadata as Record<string, unknown> | null)?.group === group)
        .map((s) => s.id)
    }

    if (sourceIds.length === 0) {
      res.json({ widgets: [], orgName: org.name })
      return
    }

    const { configs: fullConfigs, sources, events, devices } = await fetchWidgetData(sourceIds)
    const widgets = buildWidgets(fullConfigs, sources, events, devices)

    const { data: recentEvents } = await supabase
      .from('events')
      .select('id, source_id, event_type, level, message, payload, created_at')
      .in('source_id', sourceIds)
      .order('created_at', { ascending: false })
      .limit(50)

    res.json({ widgets, orgName: org.name, recentEvents: recentEvents ?? [] })
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
