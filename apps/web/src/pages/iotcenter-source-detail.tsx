import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Monitor, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { humanLabel, formatPayloadValue } from '@/lib/labels'

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
  source_type: { name: string; display_name: string }
  organization: { id: string; name: string }
}

interface SourceRaw {
  id: string
  name: string
  active: boolean
  api_key?: string
  source_type: { name: string; display_name: string } | { name: string; display_name: string }[]
  organization: { id: string; name: string } | { id: string; name: string }[]
}

interface TempLog {
  timestamp: string
  temperature: number
}

type DateRange = '1d' | '3d' | '7d' | '30d'

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

  const [chartRange, setChartRange] = useState<DateRange>('7d')
  const [tempLogs, setTempLogs] = useState<TempLog[]>([])
  const [chartThreshold, setChartThreshold] = useState(10)
  const [chartLoading, setChartLoading] = useState(false)
  const [eventFilter, setEventFilter] = useState<string>('all')

  const load = useCallback(async () => {
    if (!id) return
    try {
      setError(null)

      const { data: sourceData, error: sourceError } = await supabase
        .from('sources')
        .select(`
          id, name, active,
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

      if (sourceData) {
        const raw = sourceData as SourceRaw
        setSource({
          id: raw.id,
          name: raw.name,
          active: raw.active,
          source_type: Array.isArray(raw.source_type) ? raw.source_type[0] : raw.source_type,
          organization: Array.isArray(raw.organization) ? raw.organization[0] : raw.organization,
        })
      }

      const { data: deviceData } = await supabase
        .from('devices')
        .select('id, device_name, device_type, status, last_seen')
        .eq('source_id', id)
        .order('device_name')

      setDevices(deviceData || [])

      const { data: eventData } = await supabase
        .from('events')
        .select('id, event_type, level, message, payload, created_at, device_id')
        .eq('source_id', id)
        .order('created_at', { ascending: false })
        .limit(50)

      setEvents(eventData || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadChart = useCallback(async (range: DateRange) => {
    if (!id) return
    setChartLoading(true)
    const since = getDateSince(range)

    const { data } = await supabase
      .from('events')
      .select('created_at, payload')
      .eq('source_id', id)
      .in('event_type', ['TEMP_NORMAL', 'HIGH_TEMP'])
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })

    const fmt: (d: Date) => string = range === '1d'
      ? (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : range === '30d'
      ? (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    let threshold = 0

    if (data) {
      setTempLogs(
        data
          .filter((e) => e.payload && typeof (e.payload as Record<string, unknown>).temperature === 'number')
          .map((e) => {
            const th = (e.payload as Record<string, unknown>).threshold as number
            if (th && th > threshold) threshold = th
            return {
              timestamp: fmt(new Date(e.created_at)),
              temperature: (e.payload as Record<string, unknown>).temperature as number,
            }
          })
      )
    } else {
      setTempLogs([])
    }

    setChartThreshold(threshold || 10)
    setChartLoading(false)
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data loading on mount
    load()
  }, [load])

  useEffect(() => {
    if (source) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- chart data load on mount
      loadChart(chartRange)
    }
  }, [source, chartRange, loadChart])

  const onlineCount = devices.filter((d) => d.status === 'online').length
  const offlineCount = devices.filter((d) => d.status === 'offline').length
  const delayedCount = devices.filter((d) => d.status === 'delayed').length

  const latestTempEvent = events.find(
    (e) => e.event_type === 'TEMP_NORMAL' || e.event_type === 'HIGH_TEMP'
  )
  const currentTemp = latestTempEvent ? (latestTempEvent.payload?.temperature as number) ?? null : null

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

  const showTempChart = events.some(
    (e) => e.event_type === 'TEMP_NORMAL' || e.event_type === 'HIGH_TEMP'
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/iotcenter" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> IoTcenter
        </Link>
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
          <button
            onClick={() => setShowApiKey(!showApiKey)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {showApiKey ? 'Hide' : 'Show'} API Key
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Monitor className="w-4 h-4" />} value={String(devices.length)} label="Total Devices" />
        <StatCard icon={<CheckCircle className="w-4 h-4" />} value={String(onlineCount)} label="Online" />
        <StatCard icon={<XCircle className="w-4 h-4" />} value={String(offlineCount)} label="Offline" />
        <StatCard icon={<AlertTriangle className="w-4 h-4" />} value={String(delayedCount)} label="Delayed" />
      </div>

      {showTempChart && currentTemp !== null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground mb-1">Current Temperature</p>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${currentTemp >= 10 ? 'text-rose-600' : currentTemp >= 8 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {currentTemp.toFixed(1)}
                </span>
                <span className="text-sm text-muted-foreground">°C</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(latestTempEvent!.created_at).toLocaleString()}
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
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={tempLogs}>
                  <XAxis
                    dataKey="timestamp"
                    fontSize={11}
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis fontSize={12} unit="°C" />
                  <Tooltip />
                  <ReferenceLine
                    y={chartThreshold}
                    stroke="hsl(var(--destructive))"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    label={{ value: `${chartThreshold}°C`, position: 'right', fontSize: 11, fill: 'hsl(var(--destructive))' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="temperature"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
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
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="py-2 font-medium">{d.device_name}</td>
                      <td className="py-2 text-muted-foreground">{d.device_type}</td>
                      <td className="py-2">{deviceStatusBadge(d.status)}</td>
                      <td className="py-2 text-muted-foreground">
                        {d.last_seen ? new Date(d.last_seen).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Recent Events</CardTitle>
            <div className="flex items-center gap-1">
              {[
                { key: 'all', label: 'All' },
                { key: 'alert', label: 'Alerts' },
                { key: 'temp', label: 'Temp' },
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
          {events.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-sm">No events yet</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {events.filter((ev) => {
                if (eventFilter === 'all') return true
                if (eventFilter === 'alert') return ev.level === 'warning' || ev.level === 'critical'
                if (eventFilter === 'temp') return ev.event_type === 'TEMP_NORMAL' || ev.event_type === 'HIGH_TEMP'
                if (eventFilter === 'report') return ev.event_type.includes('REPORT')
                if (eventFilter === 'heartbeat') return ev.event_type === 'heartbeat'
                return true
              }).map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 py-2 border-b last:border-0 text-sm">
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
                      {new Date(ev.created_at).toLocaleString()}
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
