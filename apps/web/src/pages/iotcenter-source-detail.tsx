import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, Monitor, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'

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

export function IotcenterSourceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [source, setSource] = useState<SourceDetail | null>(null)
  const [devices, setDevices] = useState<DeviceSummary[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data loading on mount
    load()
  }, [load])

  const onlineCount = devices.filter((d) => d.status === 'online').length
  const offlineCount = devices.filter((d) => d.status === 'offline').length
  const delayedCount = devices.filter((d) => d.status === 'delayed').length

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
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-sm">No events yet</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {events.map((ev) => (
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
                              {key}: {typeof value === 'number' ? Number(value).toFixed(1) : String(value)}
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
