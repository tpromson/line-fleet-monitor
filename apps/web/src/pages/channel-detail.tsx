import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchBackend } from '@/lib/backend-api'
import { AlertCircle, TrendingUp, Bell, Activity } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'

interface QuotaLogRow {
  checked_at: string
  quota_used: number
  quota_remaining: number
  error?: string | null
}

interface AlertRow {
  id: string
  level: string
  message: string
  created_at: string
}

interface ChannelRowData {
  id: string
  channel_name: string
  channel_id: string
  quota_limit: number
  active: boolean
  webhook_status: 'online' | 'offline' | 'unknown'
  webhook_checked_at: string | null
  provider: { id: string; name: string } | { id: string; name: string }[]
  latest_log?: QuotaLogRow[]
  alerts: AlertRow[]
}

interface ChannelDetail {
  id: string
  channel_name: string
  channel_id: string
  quota_limit: number
  active: boolean
  webhook_status: 'online' | 'offline' | 'unknown'
  webhook_checked_at: string | null
  provider: { id: string; name: string }
  latest_log: { quota_used: number; quota_remaining: number; checked_at: string; error?: string | null } | null
  alerts: AlertRow[]
}

interface DailyLog {
  checked_at: string
  quota_used: number
}

interface ForecastData {
  daysElapsed: number
  avgDaily: number
  remaining: number
  daysLeft: number
}

function calculateForecast(quotaUsed: number, quotaLimit: number, checkedAt: string): ForecastData {
  const now = new Date(checkedAt)
  const daysElapsed = now.getDate()

  if (daysElapsed <= 1 || quotaUsed === 0) {
    return { daysElapsed: 0, avgDaily: 0, remaining: quotaLimit, daysLeft: 0 }
  }

  const avgDaily = quotaUsed / daysElapsed
  const remaining = quotaLimit - quotaUsed
  const daysLeft = avgDaily > 0 ? Math.ceil(remaining / avgDaily) : 0

  return { daysElapsed, avgDaily, remaining, daysLeft }
}

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [channel, setChannel] = useState<ChannelDetail | null>(null)
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!id) return

      try {
        const { data, error: fetchError } = await supabase
          .from('channels')
        .select(`
          id, channel_name, channel_id, quota_limit, active, webhook_status, webhook_checked_at,
          provider:provider_id (id, name),
          latest_log:quota_logs(quota_used, quota_remaining, checked_at, error),
          alerts(id, level, message, created_at)
        `)
        .eq('id', id)
          .single()

        if (fetchError) throw new Error(fetchError.message)

        if (data) {
          const d = data as ChannelRowData
        setChannel({
          id: d.id,
          channel_name: d.channel_name,
          channel_id: d.channel_id,
          quota_limit: d.quota_limit,
          active: d.active,
          webhook_status: d.webhook_status ?? 'unknown',
          webhook_checked_at: d.webhook_checked_at ?? null,
          provider: Array.isArray(d.provider) ? d.provider[0] : d.provider,
          latest_log: d.latest_log?.sort((a, b) =>
            new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime()
          )[0] ?? null,
          alerts: d.alerts ?? [],
        })
      }

      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data: logs } = await supabase
        .from('quota_logs')
        .select('checked_at, quota_used')
        .eq('channel_id', id)
        .is('error', null)
        .gte('checked_at', thirtyDaysAgo.toISOString())
        .order('checked_at', { ascending: true })

      if (logs) {
        const byDate = new Map<string, { checked_at: string; quota_used: number }>()
        for (const l of logs) {
          byDate.set(new Date(l.checked_at).toLocaleDateString(), l)
        }
        const sorted = [...byDate.entries()].sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
        const daily: DailyLog[] = []
        for (let i = 0; i < sorted.length; i++) {
          const prev = i > 0 ? (sorted[i - 1][1].quota_used || 0) : 0
          const used = (sorted[i][1].quota_used || 0) - prev
          daily.push({
            checked_at: sorted[i][0],
            quota_used: used > 0 ? used : (sorted[i][1].quota_used || 0),
          })
        }
        setDailyLogs(daily)
      }

      setLoading(false)
    } catch {
      setLoading(false)
    }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (!channel) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">Channel not found</p>
        <Link to="/dashboard" className="text-sm text-primary hover:underline mt-2 inline-block">&larr; Back to Dashboard</Link>
      </div>
    )
  }

  const forecast = channel.latest_log
    ? calculateForecast(channel.latest_log.quota_used, channel.quota_limit, channel.latest_log.checked_at ?? new Date().toISOString())
    : null

  const usagePct = channel.latest_log && !channel.latest_log.error
    ? (channel.latest_log.quota_used / channel.quota_limit) * 100
    : 0

  const alertBadge = (level: string) => {
    switch (level) {
      case 'critical': return <Badge variant="destructive">Critical</Badge>
      case 'warning': return <Badge className="bg-yellow-500 text-white">Warning</Badge>
      case 'recovery': return <Badge variant="secondary">Recovery</Badge>
      default: return null
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/providers/${channel.provider.id}`} className="text-sm text-muted-foreground hover:text-foreground">
          &larr; {channel.provider.name}
        </Link>
        <h2 className="text-2xl font-bold tracking-tight mt-1">{channel.channel_name}</h2>
        <p className="text-muted-foreground font-mono text-sm truncate">{channel.channel_id}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="hover:shadow-md hover:scale-[1.02] transition-all duration-150 border-l-2 border-l-emerald-400">
          <CardContent className="pt-6">
            <div className="text-xl font-bold">{channel.quota_limit.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Quota Limit</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md hover:scale-[1.02] transition-all duration-150 border-l-2 border-l-sky-400">
          <CardContent className="pt-6">
            <div className="text-xl font-bold">
              {channel.latest_log ? channel.latest_log.quota_used.toLocaleString() : '-'}
            </div>
            <p className="text-xs text-muted-foreground">Used</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md hover:scale-[1.02] transition-all duration-150 border-l-2 border-l-indigo-400">
          <CardContent className="pt-6">
            <div className="text-xl font-bold">
              {channel.latest_log && !channel.latest_log.error
                ? channel.latest_log.quota_remaining.toLocaleString()
                : '-'}
            </div>
            <p className="text-xs text-muted-foreground">Remaining</p>
          </CardContent>
        </Card>
        <Card className={`hover:shadow-md hover:scale-[1.02] transition-all duration-150 border-l-2 ${usagePct >= 95 ? 'border-l-rose-400' : usagePct >= 80 ? 'border-l-amber-400' : 'border-l-emerald-400'}`}>
          <CardContent className="pt-6">
            <div className={`text-xl font-bold ${usagePct >= 95 ? 'text-rose-600' : usagePct >= 80 ? 'text-amber-600' : 'text-emerald-600'}`}>{usagePct.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Usage</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="quota">
        <TabsList>
          <TabsTrigger value="quota">Quota</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="webhook">Webhook</TabsTrigger>
        </TabsList>

        <TabsContent value="quota" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Daily Usage (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyLogs.length === 0 ? (
                <div className="text-center py-8">
                  <Activity className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-muted-foreground">No data yet. Collector will start populating after first run.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dailyLogs}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="checked_at" fontSize={11} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
                    <YAxis fontSize={12} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={45} />
                    <Tooltip
                      cursor={{ fill: '#f1f5f9' }}
                      contentStyle={{ background: '#fff', border: 'none', borderRadius: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 13, padding: '8px 12px' }}
                      formatter={(value: number) => [value.toLocaleString(), 'Quota Used']}
                    />
                    <Bar dataKey="quota_used" radius={[4, 4, 0, 0]} maxBarSize={32}>
                      {dailyLogs.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.quota_used >= 80 ? '#f43f5e' :
                            entry.quota_used >= 50 ? '#f59e0b' :
                            '#10b981'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Quota Forecast</CardTitle>
            </CardHeader>
            <CardContent>
              {forecast && forecast.daysElapsed > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Average Daily</p>
                    <p className="text-2xl font-bold">{forecast.avgDaily.toFixed(1)}/day</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Remaining</p>
                    <p className="text-2xl font-bold">{forecast.remaining.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Estimated Days Left</p>
                    <p className={`text-2xl font-bold ${forecast.daysLeft <= 3 ? 'text-rose-600' : forecast.daysLeft <= 7 ? 'text-amber-600' : 'text-emerald-600'}`}>{forecast.daysLeft} days</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <TrendingUp className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-muted-foreground">
                  {channel.latest_log && channel.latest_log.quota_used === 0
                    ? 'Not enough data (current usage is 0). Data will build throughout the month.'
                    : 'No data available yet.'}
                </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Alert History</CardTitle>
            </CardHeader>
            <CardContent>
              {channel.alerts.length === 0 ? (
                <div className="text-center py-8">
                  <Bell className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-muted-foreground">No alerts yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {channel.alerts.map((alert) => (
                    <div key={alert.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        {alertBadge(alert.level)}
                        <span className="ml-2 text-sm truncate">{alert.message}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(alert.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhook" className="mt-4">
          <Card className={`${
            channel.webhook_status === 'online' ? 'bg-emerald-50/50' :
            channel.webhook_status === 'offline' ? 'bg-rose-50/50' :
            'bg-amber-50/50'
          }`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Webhook Status</CardTitle>
              <WebhookTestButton channelId={channel.id} />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div
                    role="status"
                    aria-label={`Webhook status: ${channel.webhook_status === 'online' ? 'Online' : channel.webhook_status === 'offline' ? 'Offline' : 'Unknown'}`}
                    className={`w-3 h-3 rounded-full ${
                    channel.webhook_status === 'online'
                      ? 'bg-green-500 animate-pulse'
                      : channel.webhook_status === 'offline'
                      ? 'bg-red-500'
                      : 'bg-yellow-500'
                  }`} />
                  <span className="font-medium">
                    {channel.webhook_status === 'online'
                      ? 'Online'
                      : channel.webhook_status === 'offline'
                        ? 'Offline'
                        : 'Unknown'}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Webhook Check</p>
                  <p className="font-mono text-sm">
                    {channel.webhook_checked_at
                      ? new Date(channel.webhook_checked_at).toLocaleString()
                      : 'Never'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Quota Check</p>
                  <p className="font-mono text-sm">
                    {channel.latest_log
                      ? new Date(channel.latest_log.checked_at).toLocaleString()
                      : 'Never'}
                  </p>
                </div>
                {channel.latest_log?.error && (
                  <div>
                    <p className="text-sm text-muted-foreground">Error</p>
                    <p className="text-sm text-destructive">{channel.latest_log.error}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function WebhookTestButton({ channelId }: { channelId: string }) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<'online' | 'offline' | 'unknown' | null>(null)

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      const res = await fetchBackend(`/api/channels/${channelId}/webhook-test`)
      const data = await res.json()
      setResult(data.status)
    } catch {
      setResult('unknown')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <Badge variant={result === 'online' ? 'default' : result === 'offline' ? 'destructive' : 'outline'}>
          {result === 'online' ? 'Online' : result === 'offline' ? 'Offline' : 'Unknown'}
        </Badge>
      )}
      <Button size="sm" variant="outline" onClick={test} disabled={testing}>
        {testing ? 'Testing...' : 'Test Now'}
      </Button>
    </div>
  )
}
