import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Plug, CheckCircle, XCircle, AlertTriangle, Activity, ChevronRight, Thermometer } from 'lucide-react'

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

interface EventSummary {
  id: string
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
  source_type: { name: string; display_name: string }
  organization: { id: string; name: string }
  devices: DeviceSummary[]
  events: EventSummary[]
  last_event: EventSummary | null
}

interface SourceRaw {
  id: string
  name: string
  active: boolean
  source_type: { name: string; display_name: string } | { name: string; display_name: string }[]
  organization: { id: string; name: string } | { id: string; name: string }[]
  devices: Array<{
    id: string
    device_name: string
    status: string
    last_seen: string | null
  }>
  events: Array<{
    id: string
    event_type: string
    level: string | null
    message: string | null
    payload: Record<string, unknown>
    created_at: string
  }>
}

interface TempWidget {
  sourceId: string
  sourceName: string
  currentTemp: number | null
  todayMax: number | null
  todayMin: number | null
  deviceStatus: string
}

export function IotcenterDashboardPage() {
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const { data, error: fetchError } = await supabase
        .from('sources')
        .select(`
          id, name, active,
          source_type:source_type_id(name, display_name),
          organization:organization_id(id, name),
          devices(id, device_name, status, last_seen),
          events:events(id, event_type, level, message, payload, created_at)
        `)
        .order('name')

      if (fetchError) throw new Error(fetchError.message)

      if (data) {
        setSources((data as SourceRaw[]).map((s) => {
          const sortedEvents = (s.events || []).sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
          return {
            id: s.id,
            name: s.name,
            active: s.active,
            source_type: Array.isArray(s.source_type) ? s.source_type[0] : s.source_type,
            organization: Array.isArray(s.organization) ? s.organization[0] : s.organization,
            devices: s.devices || [],
            events: sortedEvents,
            last_event: sortedEvents[0] ?? null,
          }
        }))
      }
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

  const totalSources = sources.length
  const allDevices = sources.flatMap((s) => s.devices)
  const onlineDevices = allDevices.filter((d) => d.status === 'online').length
  const offlineDevices = allDevices.filter((d) => d.status === 'offline').length
  const delayedDevices = allDevices.filter((d) => d.status === 'delayed').length
  const alertCount = sources.reduce((acc, s) => {
    return s.last_event && s.last_event.level && ['warning', 'critical'].includes(s.last_event.level) ? acc + 1 : acc
  }, 0)

  const typeMap = new Map<string, SourceSummary[]>()
  for (const s of sources) {
    const key = s.source_type.name
    if (!typeMap.has(key)) typeMap.set(key, [])
    typeMap.get(key)!.push(s)
  }

  const tempWidgets: TempWidget[] = []
  for (const s of sources) {
    const tempEvent = s.events.find(
      (e) => e.event_type === 'TEMP_NORMAL' || e.event_type === 'HIGH_TEMP'
    )
    if (!tempEvent) continue

    const todayStr = new Date().toLocaleDateString()
    const dailyReport = s.events.find(
      (e) => e.event_type === 'DAILY_REPORT' && new Date(e.created_at).toLocaleDateString() === todayStr
    )

    tempWidgets.push({
      sourceId: s.id,
      sourceName: s.name,
      currentTemp: (tempEvent.payload?.temperature as number) ?? null,
      todayMax: dailyReport ? (dailyReport.payload?.maxTemp as number) ?? null : null,
      todayMin: dailyReport ? (dailyReport.payload?.minTemp as number) ?? null : null,
      deviceStatus: s.devices.length > 0 ? s.devices[0].status : 'unknown',
    })
  }

  const deviceStatusBadge = (status: string) => {
    switch (status) {
      case 'online': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200">Online</Badge>
      case 'delayed': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200">Delayed</Badge>
      case 'offline': return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-rose-200">Offline</Badge>
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

  const getTempColor = (temp: number | null) => {
    if (temp === null) return 'text-muted-foreground'
    if (temp >= 10) return 'text-rose-600'
    if (temp >= 8) return 'text-amber-600'
    return 'text-emerald-600'
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">IoTcenter</h2>
        <p className="text-muted-foreground text-xs">Multi-source monitoring dashboard</p>
      </div>

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
          <StatCard icon={<Plug className="w-4 h-4" />} value={String(totalSources)} label="Sources" />
          <StatCard icon={<CheckCircle className="w-4 h-4" />} value={String(onlineDevices)} label="Online Devices" />
          <StatCard icon={<XCircle className="w-4 h-4" />} value={String(offlineDevices)} label="Offline Devices" warn={offlineDevices > 0} />
          <StatCard icon={<AlertTriangle className="w-4 h-4" />} value={String(delayedDevices)} label="Delayed" warn={delayedDevices > 0} />
          <StatCard icon={<Activity className="w-4 h-4" />} value={String(alertCount)} label="Active Alerts" warn={alertCount > 0} />
        </div>
      )}

      {!loading && tempWidgets.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <Thermometer className="w-4 h-4" /> Temperature Overview
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {tempWidgets.map((tw) => (
              <Link key={tw.sourceId} to={`/iotcenter/sources/${tw.sourceId}`}>
                <Card className="hover:border-primary/50 transition-colors h-full">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium truncate">{tw.sourceName}</span>
                      {deviceStatusBadge(tw.deviceStatus)}
                    </div>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className={`text-2xl font-bold ${getTempColor(tw.currentTemp)}`}>
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
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No sources configured yet. Add sources from the Setup page.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {[...typeMap.entries()].map(([typeName, typeSources]) => {
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
                      <Card className="hover:border-primary/50 transition-colors">
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
                                    Last: {new Date(source.last_event.created_at).toLocaleString()}
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
  )
}
