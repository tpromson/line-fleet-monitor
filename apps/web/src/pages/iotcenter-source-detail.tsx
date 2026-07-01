import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, flattenJoin } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Monitor, Clock, CheckCircle, XCircle, AlertTriangle, Copy, Zap, ChevronLeft, ChevronRight } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Area, CartesianGrid } from 'recharts'
import { humanLabel, formatPayloadValue, formatTimestamp } from '@/lib/labels'
import { fetchBackend } from '@/lib/backend-api'
import { toast } from 'sonner'

interface DeviceSummary {
  id: string
  device_name: string
  device_type: string
  status: string
  last_seen: string | null
}

interface EventRow {
  id: string
  event_type: string
  level: string | null
  message: string | null
  payload: Record<string, unknown>
  created_at: string
  device_id: string | null
}

interface SourceDetail {
  id: string
  name: string
  active: boolean
  api_key?: string
  metadata: Record<string, unknown>
  source_type: { name: string; display_name: string }
  organization: { id: string; name: string }
}

interface SourceRaw {
  id: string
  name: string
  active: boolean
  api_key?: string
  metadata: Record<string, unknown>
  source_type: { name: string; display_name: string } | { name: string; display_name: string }[]
  organization: { id: string; name: string } | { id: string; name: string }[]
}

interface TempLog {
  timestamp: string
  rawTs: number
  temperature: number
  humidity?: number
}

interface AlertBand {
  x1: number
  x2: number
  level: 'warning' | 'critical'
}

interface AlertEvent {
  created_at: string
  level: string | null
}

type DateRange = '1d' | '3d' | '7d' | '30d'

function buildAlertBands(events: AlertEvent[]): Array<{ start: number; end: number; level: 'warning' | 'critical' }> {
  const bands: Array<{ start: number; end: number; level: 'warning' | 'critical' }> = []
  let current: { start: number; end: number; level: 'warning' | 'critical' } | null = null

  for (const e of events) {
    const ts = new Date(e.created_at).getTime()
    if (e.level === 'warning' || e.level === 'critical') {
      if (!current) {
        current = { start: ts, end: ts, level: e.level }
      } else {
        current.end = ts
        if (e.level === 'critical') current.level = 'critical'
      }
    } else if (current) {
      bands.push(current)
      current = null
    }
  }
  if (current) bands.push(current)
  return bands
}

function snapToChart(ts: number, tempLogs: TempLog[]): number | null {
  if (tempLogs.length === 0) return null
  let nearest = tempLogs[0]
  let minDiff = Math.abs(nearest.rawTs - ts)
  for (let i = 1; i < tempLogs.length; i++) {
    const diff = Math.abs(tempLogs[i].rawTs - ts)
    if (diff < minDiff) {
      nearest = tempLogs[i]
      minDiff = diff
    }
  }
  return nearest.rawTs
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-xl font-bold">{value}</span>
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}

const DATE_LABELS: Record<DateRange, string> = {
  '1d': 'Today',
  '3d': '3 Days',
  '7d': '7 Days',
  '30d': '30 Days',
}

function getDateSince(range: DateRange): Date {
  const d = new Date()
  switch (range) {
    case '1d': d.setDate(d.getDate() - 1); break
    case '3d': d.setDate(d.getDate() - 3); break
    case '7d': d.setDate(d.getDate() - 7); break
    case '30d': d.setDate(d.getDate() - 30); break
  }
  return d
}

export function IotcenterSourceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [source, setSource] = useState<SourceDetail | null>(null)
  const [devices, setDevices] = useState<DeviceSummary[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  const [siblings, setSiblings] = useState<{ id: string; name: string }[]>([])

  const [chartRange, setChartRange] = useState<DateRange>('7d')
  const [tempLogs, setTempLogs] = useState<TempLog[]>([])
  const [alertBands, setAlertBands] = useState<AlertBand[]>([])
  const [chartThreshold, setChartThreshold] = useState(10)
  const [chartMax, setChartMax] = useState(30)
  const [hasHumidity, setHasHumidity] = useState(false)
  const [chartLoading, setChartLoading] = useState(false)
  const chartLoadId = useRef(0)
  const [eventFilter, setEventFilter] = useState<string>('all')
  const [eventRange, setEventRange] = useState<DateRange>('1d')
  const [eventLoading, setEventLoading] = useState(false)
  const [bootEvents, setBootEvents] = useState<EventRow[]>([])
  const [bootCount24h, setBootCount24h] = useState(0)
  const [bootCountTotal, setBootCountTotal] = useState(0)

  const load = useCallback(async () => {
    if (!id) return
    try {
      setError(null)

      const { data: sourceData, error: sourceError } = await supabase
        .from('sources')
        .select(`
          id, name, active, metadata,
          source_type:source_type_id(name, display_name),
          organization:organization_id(id, name)
        `)
        .eq('id', id)
        .single()

      if (sourceError) {
        if (sourceError.code === 'PGRST116') {
          setError('Source not found or access denied')
          setLoading(false)
          return
        }
        throw new Error(sourceError.message)
      }

      let orgId: string | undefined
      if (sourceData) {
        const raw = sourceData as SourceRaw
        orgId = (flattenJoin(raw.organization) as { id: string } | null)?.id
        setSource({
          id: raw.id,
          name: raw.name,
          active: raw.active,
          api_key: raw.api_key,
          metadata: (raw.metadata as Record<string, unknown>) || {},
          source_type: flattenJoin(raw.source_type)!,
          organization: flattenJoin(raw.organization)!,
        })
      }

      const { data: deviceData } = await supabase
        .from('devices')
        .select('id, device_name, device_type, status, last_seen')
        .eq('source_id', id)
        .order('device_name')

      setDevices(deviceData || [])

      const { data: bootData } = await supabase
        .from('events')
        .select('id, event_type, level, message, payload, created_at, device_id')
        .eq('source_id', id)
        .in('event_type', ['DEVICE_BOOT', 'BOOT_WDT', 'BOOT'])
        .order('created_at', { ascending: false })
        .limit(100)

      setBootEvents(bootData || [])

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const recentBoots = (bootData || []).filter((e) => e.created_at >= dayAgo)
      setBootCount24h(recentBoots.length)

      const { count: totalBootCount } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('source_id', id)
        .in('event_type', ['DEVICE_BOOT', 'BOOT_WDT', 'BOOT'])
      setBootCountTotal(totalBootCount ?? 0)

      const { data: { user } } = await supabase.auth.getUser()
      setIsSuperAdmin(user?.app_metadata?.role === 'super_admin')

      if (orgId) {
        const { data: sibData } = await supabase
          .from('sources')
          .select('id, name')
          .eq('organization_id', orgId)
          .order('name')
        setSiblings(sibData ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadEvents = useCallback(async (range: DateRange) => {
    if (!id) return
    setEventLoading(true)
    const since = getDateSince(range)
    const { data } = await supabase
      .from('events')
      .select('id, event_type, level, message, payload, created_at, device_id')
      .eq('source_id', id)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(500)
    setEvents(data || [])
    setEventLoading(false)
  }, [id])

  const loadChart = useCallback(async (range: DateRange, srcThreshold: number) => {
    if (!id) return
    const loadId = ++chartLoadId.current
    setChartLoading(true)
    const since = getDateSince(range)

    const [tempRes, alertRes] = await Promise.all([
      supabase
        .from('events')
        .select('created_at, payload, event_type')
        .eq('source_id', id)
        .in('event_type', ['TEMP_NORMAL', 'HIGH_TEMP', 'heartbeat'])
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: true })
        .limit(50000),
      supabase
        .from('events')
        .select('created_at, level')
        .eq('source_id', id)
        .in('level', ['warning', 'critical'])
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: true })
        .limit(50000),
    ])

    if (loadId !== chartLoadId.current) return

    const data = tempRes.data
    if (data) {
      const logs: TempLog[] = []
      let hasHumid = false
      for (const e of data) {
        const p = e.payload as Record<string, unknown>
        const isHeartbeat = e.event_type === 'heartbeat'
        const t = isHeartbeat
          ? (p.temperature as number | undefined)
          : (p.temperature as number) ?? (p.lastTemperature as number)
        const h = isHeartbeat
          ? (p.humidity as number | undefined)
          : (p.humidity as number) ?? (p.lastHumidity as number)
        if (typeof t === 'number') {
          const ts = new Date(e.created_at)
          const log: TempLog = { timestamp: ts.toLocaleString(), rawTs: ts.getTime(), temperature: t }
          if (typeof h === 'number' && h > 0) { log.humidity = h; hasHumid = true }
          logs.push(log)
        }
      }
      const displayLogs = range === '30d' && logs.length > 1000
        ? logs.filter((_, i) => i % Math.ceil(logs.length / 500) === 0)
        : logs

      setTempLogs(displayLogs)
      setHasHumidity(hasHumid)

      if (displayLogs.length > 0) {
        const maxT = Math.ceil(Math.max(...displayLogs.map((l) => l.temperature)) + 5)
        setChartMax(maxT > srcThreshold + 2 ? maxT : srcThreshold + 2)

        const alertEvents = (alertRes.data ?? []) as AlertEvent[]
        const rawBands = buildAlertBands(alertEvents)
        const chartBands: AlertBand[] = []
        for (const b of rawBands) {
          const x1 = snapToChart(b.start, displayLogs)
          const x2 = snapToChart(b.end, displayLogs)
          if (x1 && x2) chartBands.push({ x1, x2, level: b.level })
        }
        setAlertBands(chartBands)
      } else {
        setAlertBands([])
      }
    } else {
      setTempLogs([])
      setAlertBands([])
    }

    if (loadId === chartLoadId.current) {
      setChartThreshold(srcThreshold || 10)
      setChartLoading(false)
    }
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data loading on mount
    load()
  }, [load])

  useEffect(() => {
    if (source) {
      const srcThreshold = (source.metadata?.threshold as number) || 10
      // eslint-disable-next-line react-hooks/set-state-in-effect -- chart data load on mount
      loadChart(chartRange, srcThreshold)
    }
  }, [source, chartRange, loadChart])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- event load on range change
    loadEvents(eventRange)
  }, [loadEvents, eventRange])

  const currentIdx = siblings.findIndex((s) => s.id === id)
  const prevSource = currentIdx > 0 ? siblings[currentIdx - 1] : null
  const nextSource = currentIdx !== -1 && currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null

  const onlineCount = devices.filter((d) => d.status === 'online').length
  const offlineCount = devices.filter((d) => d.status === 'offline').length
  const delayedCount = devices.filter((d) => d.status === 'delayed').length

  const lastBootByDevice = new Map<string, string>()
  for (const ev of bootEvents) {
    if (ev.device_id && !lastBootByDevice.has(ev.device_id)) {
      lastBootByDevice.set(ev.device_id, ev.created_at)
    }
  }

  const latestTempEvent = events.find(
    (e) => e.event_type === 'TEMP_NORMAL' || e.event_type === 'HIGH_TEMP' ||
      (e.event_type === 'heartbeat' && (e.payload?.temperature || e.payload?.lastTemperature))
  )
  const currentTemp = latestTempEvent ? (latestTempEvent.payload?.temperature as number) ?? (latestTempEvent.payload?.lastTemperature as number) ?? null : null
  const srcThreshold = source ? ((source.metadata?.threshold as number) || 10) : 10

  const deviceStatusBadge = (status: string) => {
    switch (status) {
      case 'online': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200">Online</Badge>
      case 'delayed': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200">Delayed</Badge>
      case 'offline': return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-rose-200">Offline</Badge>
      default: return <Badge variant="outline">Unknown</Badge>
    }
  }

  const eventLevelBadge = (level: string | null) => {
    switch (level) {
      case 'critical': return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-rose-200">Critical</Badge>
      case 'warning': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200">Warning</Badge>
      case 'recovery': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200">Recovery</Badge>
      case 'info': return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200">Info</Badge>
      default: return <Badge variant="outline">-</Badge>
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2"><Skeleton className="h-5 w-20" /></div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !source) {
    return (
      <div className="space-y-6">
        <Link to="/iotcenter" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> IoTcenter
        </Link>
        <Card className="border-destructive">
          <CardContent className="py-6 text-center">
            <p className="text-destructive font-medium">{error || 'Source not found'}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const showTempChart = tempLogs.length > 0 || events.some(
    (e) => e.event_type === 'TEMP_NORMAL' || e.event_type === 'HIGH_TEMP' ||
      (e.event_type === 'heartbeat' && (e.payload?.temperature || e.payload?.lastTemperature))
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/iotcenter" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> IoTcenter
        </Link>
        {siblings.length > 1 && (
          <div className="flex items-center gap-1">
            {prevSource ? (
              <Link
                to={`/iotcenter/sources/${prevSource.id}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="max-w-[120px] truncate">{prevSource.name}</span>
              </Link>
            ) : (
              <span className="px-2 py-1 text-xs text-muted-foreground/40 flex items-center gap-1">
                <ChevronLeft className="w-3.5 h-3.5" />
              </span>
            )}
            <span className="text-xs text-muted-foreground/50">
              {currentIdx + 1} / {siblings.length}
            </span>
            {nextSource ? (
              <Link
                to={`/iotcenter/sources/${nextSource.id}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
              >
                <span className="max-w-[120px] truncate">{nextSource.name}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            ) : (
              <span className="px-2 py-1 text-xs text-muted-foreground/40 flex items-center gap-1">
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{source.name}</h2>
          <p className="text-muted-foreground text-xs">
            {source.organization.name} &middot; {source.source_type.display_name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!source.active && <Badge variant="outline">Paused</Badge>}
          {isSuperAdmin && (
            <>
          <button
            onClick={async () => {
              if (!showApiKey && !apiKeyValue) {
                try {
                  const res = await fetchBackend(`/api/iotcenter/sources/${source.id}/api-key`)
                  if (res.ok) {
                    const data = await res.json()
                    setApiKeyValue(data.api_key ?? '')
                  }
                } catch { /* ignore */ }
              }
              setShowApiKey(!showApiKey)
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {showApiKey ? 'Hide' : 'Show'} API Key
          </button>
          {showApiKey && apiKeyValue && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(apiKeyValue)
                toast.success('API Key copied')
              }}
            >
              <Copy className="w-3 h-3 mr-1" /> Copy
            </Button>
          )}
            </>
          )}
        </div>
      </div>
      {showApiKey && apiKeyValue && (
        <div className="bg-muted rounded-md p-2">
          <code className="text-xs break-all text-muted-foreground">{apiKeyValue}</code>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { icon: <Monitor className="w-4 h-4" />, value: String(devices.length), label: 'Total Devices' },
          { icon: <CheckCircle className="w-4 h-4" />, value: String(onlineCount), label: 'Online' },
          { icon: <XCircle className="w-4 h-4" />, value: String(offlineCount), label: 'Offline' },
          { icon: <AlertTriangle className="w-4 h-4" />, value: String(delayedCount), label: 'Delayed' },
          { icon: <Zap className="w-4 h-4" />, value: String(bootCount24h), label: 'Boots (24h)', warn: bootCount24h > 0 },
          { icon: <Zap className="w-4 h-4" />, value: String(bootCountTotal), label: 'Boots (All)', warn: bootCountTotal > 0 },
        ].map((stat, i) => (
          <div key={stat.label} className="animate-slide-up-fade" style={{ animationDelay: `${i * 60}ms` }}>
            <StatCard icon={stat.icon} value={stat.value} label={stat.label} />
          </div>
        ))}
      </div>

      {showTempChart && currentTemp !== null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-slide-up-fade" style={{ animationDelay: '240ms' }}>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground mb-1">Current Temperature</p>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${currentTemp <= 0 ? 'text-sky-500' : currentTemp >= srcThreshold ? 'text-rose-600' : currentTemp >= srcThreshold * 0.9 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {currentTemp.toFixed(1)}
                </span>
                <span className="text-sm text-muted-foreground">°C</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatTimestamp(latestTempEvent!.created_at)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {showTempChart && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Temperature</CardTitle>
              <div className="flex items-center gap-1">
                {(Object.keys(DATE_LABELS) as DateRange[]).map((range) => (
                  <Button
                    key={range}
                    variant={chartRange === range ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setChartRange(range)}
                    disabled={chartLoading}
                  >
                    {DATE_LABELS[range]}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {chartLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : tempLogs.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No temperature data for this period</p>
            ) : (
              <div className="animate-fade-in">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-0.5 bg-blue-500 rounded-full" />
                  <span>Temperature</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-400" />
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  <span>Warning period</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-rose-100 border border-rose-400" />
                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                  <span>Critical period</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-px border-t-2 border-dashed border-rose-500" />
                  <span>Threshold ({chartThreshold}°C)</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={tempLogs} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <ReferenceArea
                    y1={chartThreshold}
                    y2={chartMax}
                    fill="#fef2f2"
                    stroke="none"
                  />
                  {alertBands.map((band, i) => (
                    <ReferenceArea
                      key={`alert-${i}-${band.x1}`}
                      x1={band.x1}
                      x2={band.x2}
                      y1={-1000}
                      y2={1000}
                      fill={band.level === 'critical' ? '#fee2e2' : '#fef3c7'}
                      fillOpacity={band.level === 'critical' ? 0.7 : 0.55}
                      stroke={band.level === 'critical' ? '#f43f5e' : '#f59e0b'}
                      strokeOpacity={0.45}
                      strokeDasharray="2 2"
                      strokeWidth={1}
                      ifOverflow="extendDomain"
                    />
                  ))}
                  <XAxis
                    dataKey="rawTs"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    fontSize={11}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={false}
                    tickFormatter={(ts: number) => {
                      const d = new Date(ts)
                      if (chartRange === '1d') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      if (chartRange === '30d') return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
                      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }}
                    height={36}
                  />
                  <YAxis
                    fontSize={12}
                    unit="°C"
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={45}
                  />
                  {hasHumidity && (
                    <YAxis
                      yAxisId="humidity"
                      orientation="right"
                      unit="%"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#06b6d4' }}
                      axisLine={false}
                      tickLine={false}
                      width={45}
                    />
                  )}
                  <Tooltip
                    cursor={{ stroke: '#94a3b8', strokeDasharray: '4 4', strokeWidth: 1 }}
                    contentStyle={{
                      background: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      fontSize: 13,
                      padding: '8px 12px',
                    }}
                    formatter={(value: number, name: string) => [value.toFixed(1) + (name === 'humidity' ? '%' : '°C'), name === 'humidity' ? 'Humidity' : 'Temperature']}
                    labelFormatter={(label: number) => new Date(label).toLocaleString()}
                  />
                  <ReferenceLine
                    y={chartThreshold}
                    stroke="#ef4444"
                    strokeDasharray="6 3"
                    strokeWidth={1.5}
                    label={{
                      value: `${chartThreshold}°C`,
                      position: 'insideTopRight',
                      fontSize: 11,
                      fill: '#ef4444',
                      fontWeight: 600,
                    }}
                  />
                  <Area
                    type="linear"
                    dataKey="temperature"
                    fill="url(#tempGradient)"
                    stroke="none"
                  />
                  <Line
                    type="linear"
                    dataKey="temperature"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }}
                  />
                  {hasHumidity && (
                    <Line
                      yAxisId="humidity"
                      type="linear"
                      dataKey="humidity"
                      stroke="#06b6d4"
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 4, fill: '#06b6d4', stroke: '#fff', strokeWidth: 2 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {devices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Devices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Last Seen</th>
                    <th className="pb-2 font-medium">Last Boot</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d, i) => {
                    const lastBoot = lastBootByDevice.get(d.id)
                    return (
                      <tr key={d.id} className="border-t animate-slide-up-fade hover:bg-muted/30 transition-colors" style={{ animationDelay: `${i * 50}ms` }}>
                        <td className="py-2 font-medium">{d.device_name}</td>
                        <td className="py-2 text-muted-foreground">{d.device_type}</td>
                        <td className="py-2">{deviceStatusBadge(d.status)}</td>
                        <td className="py-2 text-muted-foreground">
                          {d.last_seen ? formatTimestamp(d.last_seen) : '-'}
                        </td>
                        <td className="py-2">
                          {lastBoot ? (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Zap className="w-3 h-3 text-amber-500" />
                              {formatTimestamp(lastBoot)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">Recent Events</CardTitle>
              <div className="flex items-center gap-0.5">
                {(['1d', '3d', '7d'] as DateRange[]).map((r) => (
                  <Button
                    key={r}
                    variant={eventRange === r ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setEventRange(r)}
                    disabled={eventLoading}
                    className="h-6 text-xs px-2"
                  >
                    {DATE_LABELS[r]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {[
                { key: 'all', label: 'All' },
                { key: 'alert', label: 'Alerts' },
                { key: 'temp', label: 'Temp' },
                { key: 'boot', label: 'Boot' },
                { key: 'report', label: 'Reports' },
                { key: 'heartbeat', label: 'Heartbeats' },
              ].map((f) => (
                <Button
                  key={f.key}
                  variant={eventFilter === f.key ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setEventFilter(f.key)}
                  className="h-7 text-xs px-2"
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {eventLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : events.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-sm">No events in this period</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {events.filter((ev) => {
                if (eventFilter === 'all') return true
                if (eventFilter === 'alert') return ev.level === 'warning' || ev.level === 'critical'
                if (eventFilter === 'temp') return ev.event_type === 'TEMP_NORMAL' || ev.event_type === 'HIGH_TEMP'
                if (eventFilter === 'boot') return ev.event_type === 'DEVICE_BOOT' || ev.event_type === 'BOOT_WDT' || ev.event_type === 'BOOT'
                if (eventFilter === 'report') return ev.event_type.includes('REPORT')
                if (eventFilter === 'heartbeat') return ev.event_type === 'heartbeat'
                return true
              }).map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 py-2 border-b last:border-0 text-sm animate-fade-in">
                  <div className="shrink-0 mt-0.5">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ev.event_type.replace(/_/g, ' ')}</span>
                      {ev.level && eventLevelBadge(ev.level)}
                    </div>
                    {ev.message && <p className="text-muted-foreground mt-0.5">{ev.message}</p>}
                    {ev.payload && Object.keys(ev.payload).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {Object.entries(ev.payload)
                          .filter(([, v]) => v !== null && v !== undefined)
                          .map(([key, value]) => (
                            <span key={key} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {humanLabel(key)}: {formatPayloadValue(value)}
                            </span>
                          ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatTimestamp(ev.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
