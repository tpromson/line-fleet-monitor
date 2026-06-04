import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Plug, CheckCircle, XCircle, AlertTriangle, Activity, ChevronRight, ChevronDown, Thermometer, Snowflake } from 'lucide-react'
import { formatTimestamp } from '@/lib/labels'

interface StatCardProps {
  icon: React.ReactNode
  value: string
  label: string
  warn?: boolean
}

function StatCard({ icon, value, label, warn }: StatCardProps) {
  return (
    <Card className={warn ? 'border-destructive' : ''}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground">{icon}</span>
          <span className={`text-xl font-bold ${warn ? 'text-destructive' : ''}`}>{value}</span>
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}

interface DeviceSummary {
  id: string
  device_name: string
  status: string
  last_seen: string | null
}

interface EventData {
  id: string
  source_id: string
  event_type: string
  level: string | null
  message: string | null
  payload: Record<string, unknown>
  created_at: string
}

interface SourceSummary {
  id: string
  name: string
  active: boolean
  metadata: Record<string, unknown>
  source_type: { name: string; display_name: string }
  organization: { id: string; name: string }
  devices: DeviceSummary[]
  last_event: EventData | null
}

interface TempWidget {
  sourceId: string
  sourceName: string
  currentTemp: number | null
  todayMax: number | null
  todayMin: number | null
  todayAvg: number | null
  threshold: number
  deviceStatus: string
}

export function IotcenterDashboardPage() {
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [tempWidgets, setTempWidgets] = useState<TempWidget[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsedSources, setCollapsedSources] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState('all')
  const [tabStyle, setTabStyle] = useState({ left: 0, width: 0 })
  const tabContainerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)

      const { data: sourcesData, error: sourcesError } = await supabase
        .from('sources')
        .select(`
          id, name, active, metadata,
          source_type:source_type_id(name, display_name),
          organization:organization_id(id, name),
          devices(id, device_name, status, last_seen)
        `)
        .order('name')

      if (sourcesError) throw new Error(sourcesError.message)

      const srcList: SourceSummary[] = (sourcesData || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        name: s.name as string,
        active: s.active as boolean,
        metadata: (s.metadata as Record<string, unknown>) || {},
        source_type: (Array.isArray(s.source_type) ? s.source_type[0] : s.source_type) as { name: string; display_name: string },
        organization: (Array.isArray(s.organization) ? s.organization[0] : s.organization) as { id: string; name: string },
        devices: (s.devices || []) as DeviceSummary[],
        last_event: null,
      }))

      if (srcList.length === 0) {
        setSources([])
        setTempWidgets([])
        setLoading(false)
        return
      }

      const sourceIds = srcList.map((s) => s.id)

      const { data: allEvents, error: eventsError } = await supabase
        .from('events')
        .select('id, source_id, event_type, level, message, payload, created_at')
        .in('source_id', sourceIds)
        .in('event_type', ['TEMP_NORMAL', 'HIGH_TEMP', 'DAILY_REPORT', 'heartbeat'])
        .order('created_at', { ascending: false })
        .limit(1000)

      if (eventsError) throw new Error(eventsError.message)

      const eventsBySource = new Map<string, EventData[]>()
      for (const ev of (allEvents || []) as EventData[]) {
        const list = eventsBySource.get(ev.source_id)
        if (list) list.push(ev)
        else eventsBySource.set(ev.source_id, [ev])
      }

      const todayStr = new Date().toLocaleDateString()

      const widgets: TempWidget[] = []

      for (const src of srcList) {
        const events = eventsBySource.get(src.id)
        if (!events) continue

        const sorted = events.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )

        src.last_event = sorted[0] ?? null

        const tempEvent = events.find(
          (e) => e.event_type === 'TEMP_NORMAL' || e.event_type === 'HIGH_TEMP' ||
            (e.event_type === 'heartbeat' && (e.payload?.temperature || e.payload?.lastTemperature))
        )
        if (!tempEvent) continue

        const dailyReport = events.find(
          (e) => e.event_type === 'DAILY_REPORT' && new Date(e.created_at).toLocaleDateString() === todayStr
        )

        const todayTemps = events
          .filter((e) => new Date(e.created_at).toLocaleDateString() === todayStr)
          .map((e) => (e.payload?.temperature as number) ?? (e.payload?.lastTemperature as number))
          .filter((t) => typeof t === 'number')
        const realtimeMax = todayTemps.length > 0 ? Math.max(...todayTemps) : null
        const realtimeMin = todayTemps.length > 0 ? Math.min(...todayTemps) : null
        const realtimeAvg = todayTemps.length > 0 ? todayTemps.reduce((a, b) => a + b, 0) / todayTemps.length : null

    widgets.push({
      sourceId: src.id,
      sourceName: src.name,
      currentTemp: (tempEvent.payload?.temperature as number) ?? (tempEvent.payload?.lastTemperature as number) ?? null,
      todayMax: dailyReport ? (dailyReport.payload?.maxTemp as number) ?? realtimeMax : realtimeMax,
      todayMin: dailyReport ? (dailyReport.payload?.minTemp as number) ?? realtimeMin : realtimeMin,
      todayAvg: dailyReport ? (dailyReport.payload?.avgTemp as number) ?? realtimeAvg : realtimeAvg,
      threshold: (src.metadata?.threshold as number) || 10,
      deviceStatus: src.devices.length > 0 ? src.devices[0].status : 'unknown',
    })
      }

      setSources(srcList)
      setTempWidgets(widgets)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data loading on mount and interval
    load()
    const interval = setInterval(() => { load() }, 60000)
    return () => clearInterval(interval)
  }, [load])

  const orgOptions = useMemo(
    () => [...new Map(sources.map((s) => [s.organization.id, s.organization])).values()],
    [sources]
  )

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = tabRefs.current.get(selectedOrgId)
      const container = tabContainerRef.current
      if (el && container) {
        const cRect = container.getBoundingClientRect()
        const eRect = el.getBoundingClientRect()
        setTabStyle({ left: eRect.left - cRect.left, width: eRect.width })
      }
    })
  }, [selectedOrgId, orgOptions])
  const filteredSources = selectedOrgId === 'all' ? sources : sources.filter((s) => s.organization.id === selectedOrgId)
  const filteredWidgets = selectedOrgId === 'all' ? tempWidgets : tempWidgets.filter((tw) => sources.find((s) => s.id === tw.sourceId)?.organization.id === selectedOrgId)

  const totalSources = filteredSources.length
  const allDevices = filteredSources.flatMap((s) => s.devices)
  const onlineDevices = allDevices.filter((d) => d.status === 'online').length
  const offlineDevices = allDevices.filter((d) => d.status === 'offline').length
  const delayedDevices = allDevices.filter((d) => d.status === 'delayed').length
  const alertCount = filteredSources.reduce((acc, s) => {
    return s.last_event && s.last_event.level && ['warning', 'critical'].includes(s.last_event.level) ? acc + 1 : acc
  }, 0)

  const filteredTypeMap = new Map<string, SourceSummary[]>()
  for (const s of filteredSources) {
    const key = s.source_type.name
    if (!filteredTypeMap.has(key)) filteredTypeMap.set(key, [])
    filteredTypeMap.get(key)!.push(s)
  }

  const deviceStatusBadge = (status: string) => {
    switch (status) {
      case 'online': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200">Online</Badge>
      case 'delayed': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200">Delayed</Badge>
      case 'offline': return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-rose-200 animate-pulse">Offline</Badge>
      default: return <Badge variant="outline">Unknown</Badge>
    }
  }

  const levelBadge = (level: string | null) => {
    switch (level) {
      case 'critical': return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-rose-200">Critical</Badge>
      case 'warning': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200">Warning</Badge>
      case 'info': return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200">Info</Badge>
      default: return <Badge variant="outline">-</Badge>
    }
  }

  const getTempColor = (temp: number | null, threshold: number) => {
    if (temp === null) return 'text-muted-foreground'
    if (temp <= 0) return 'text-sky-500'
    if (temp >= threshold) return 'text-rose-600'
    if (temp >= threshold * 0.9) return 'text-amber-600'
    return 'text-emerald-600'
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">IoTcenter</h2>
        <p className="text-muted-foreground text-xs">Multi-source monitoring dashboard</p>
      </div>

      {!loading && orgOptions.length > 0 && (
        <div
          ref={tabContainerRef}
          className="relative flex gap-1.5 overflow-x-auto rounded-lg p-1 bg-muted/50"
        >
          <div
            className="absolute inset-y-1 bg-background rounded-md shadow-sm transition-all duration-300"
            style={{ left: tabStyle.left, width: tabStyle.width }}
          />
          {[{ id: 'all', name: 'All' }, ...orgOptions].map((item) => (
            <Button
              key={item.id}
              ref={(el) => {
                if (el) tabRefs.current.set(item.id, el)
                else tabRefs.current.delete(item.id)
              }}
              variant="ghost"
              size="sm"
              className="relative z-10 h-7 text-xs shrink-0"
              onClick={() => setSelectedOrgId(item.id)}
            >
              {item.name}
            </Button>
          ))}
        </div>
      )}

      <div key={selectedOrgId} className="animate-fade-in">
      {!loading && filteredWidgets.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <Thermometer className="w-4 h-4" /> Temperature Overview
            {filteredWidgets.every((tw) => tw.currentTemp !== null && tw.currentTemp < tw.threshold) && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">All Clear</span>
            )}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredWidgets.map((tw, i) => (
              <Link key={tw.sourceId} to={`/iotcenter/sources/${tw.sourceId}`} className="animate-slide-up-fade" style={{ animationDelay: `${i * 60}ms` }}>
                <Card className={`hover:border-primary/50 hover:shadow-md hover:scale-[1.02] transition-all duration-150 h-full ${
                  tw.currentTemp !== null && tw.currentTemp >= tw.threshold
                    ? 'ring-1 ring-rose-200/70'
                    : tw.currentTemp !== null && tw.currentTemp >= tw.threshold * 0.9
                    ? 'ring-1 ring-amber-200/70'
                    : tw.currentTemp !== null && tw.currentTemp > 0
                    ? 'ring-1 ring-emerald-200/50'
                    : ''
                }`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium truncate">{tw.sourceName}</span>
                      <div className="flex items-center gap-1">
                        {tw.currentTemp !== null && tw.currentTemp <= 0 && (
                          <Snowflake className="w-3.5 h-3.5 text-sky-400" />
                        )}
                        {deviceStatusBadge(tw.deviceStatus)}
                      </div>
                    </div>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className={`text-2xl font-bold ${getTempColor(tw.currentTemp, tw.threshold)}`}>
                        {tw.currentTemp !== null ? tw.currentTemp.toFixed(1) : '-'}
                      </span>
                      <span className="text-xs text-muted-foreground">°C</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        🔺 {tw.todayMax !== null ? tw.todayMax.toFixed(1) + '°C' : '-'}
                      </span>
                      <span>
                        🔻 {tw.todayMin !== null ? tw.todayMin.toFixed(1) + '°C' : '-'}
                      </span>
                      <span>
                        ▸ {tw.todayAvg !== null ? tw.todayAvg.toFixed(1) + '°C' : '-'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-3"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive">
          <CardContent className="py-6 text-center">
            <p className="text-destructive font-medium">Failed to load</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { icon: <Plug className="w-4 h-4 group-hover:scale-110 transition-transform" />, value: String(totalSources), label: 'Sources', border: 'border-l-2 border-l-slate-300' },
            { icon: <CheckCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />, value: onlineDevices + ' / ' + allDevices.length, label: 'Online Devices', border: 'border-l-2 border-l-emerald-400' },
            { icon: <XCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />, value: String(offlineDevices), label: 'Offline Devices', warn: offlineDevices > 0, border: offlineDevices > 0 ? 'border-l-2 border-l-rose-400' : 'border-l-2 border-l-slate-200' },
            { icon: <AlertTriangle className="w-4 h-4 group-hover:scale-110 transition-transform" />, value: String(delayedDevices), label: 'Delayed', warn: delayedDevices > 0, border: delayedDevices > 0 ? 'border-l-2 border-l-amber-400' : 'border-l-2 border-l-slate-200' },
            { icon: <Activity className="w-4 h-4 group-hover:scale-110 transition-transform" />, value: String(alertCount), label: 'Active Alerts', warn: alertCount > 0, border: alertCount > 0 ? 'border-l-2 border-l-rose-400' : 'border-l-2 border-l-slate-200' },
          ].map((stat, i) => (
            <div key={stat.label} className={`animate-slide-up-fade group ${stat.border}`} style={{ animationDelay: `${i * 60}ms` }}>
              <StatCard icon={stat.icon} value={stat.value} label={stat.label} warn={stat.warn} />
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : filteredSources.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No sources yet — ready to start monitoring. Add your first sensor from the Setup page.
          </CardContent>
        </Card>
      ) : (
        <div>
          <button
            onClick={() => setCollapsedSources(!collapsedSources)}
            className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground mb-3 w-full text-left transition-colors duration-150"
          >
            {collapsedSources ? <ChevronRight className="w-4 h-4 transition-transform duration-200" /> : <ChevronDown className="w-4 h-4 transition-transform duration-200" />}
            All Sources ({filteredSources.length})
          </button>
          {!collapsedSources && (
            <div className="space-y-8">
              {[...filteredTypeMap.entries()].map(([typeName, typeSources]) => {
                const typeDisplay = typeSources[0]?.source_type.display_name ?? typeName
                return (
                  <div key={typeName}>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">{typeDisplay}</h3>
                    <div className="space-y-2">
                      {typeSources.map((source) => (
                        <Link
                          key={source.id}
                          to={`/iotcenter/sources/${source.id}`}
                          className="block"
                        >
                          <Card className="hover:border-primary/50 hover:shadow-sm hover:scale-[1.01] transition-all duration-150">
                            <CardContent className="py-3 px-4">
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium truncate">{source.name}</span>
                                    {!source.active && <Badge variant="outline" className="text-xs">Paused</Badge>}
                                  </div>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-xs text-muted-foreground">{source.organization.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {source.devices.length} device{source.devices.length !== 1 ? 's' : ''}
                                    </span>
                                    {source.last_event && (
                                      <span className="text-xs text-muted-foreground">
                                        Last: {formatTimestamp(source.last_event.created_at)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {source.last_event && levelBadge(source.last_event.level)}
                                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                </div>
                              </div>
                              {source.devices.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {source.devices.map((d) => deviceStatusBadge(d.status))}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
