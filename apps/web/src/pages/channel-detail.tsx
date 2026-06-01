import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchBackend } from '@/lib/backend-api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface AlertRow {
  id: string
  level: string
  message: string
  created_at: string
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
  latest_log: { quota_used: number; quota_remaining: number; checked_at: string; error: string | null } | null
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

      const { data } = await supabase
        .from('channels')
        .select(`
          id, channel_name, channel_id, quota_limit, active, webhook_status, webhook_checked_at,
          provider:provider_id (id, name),
          latest_log:quota_logs(quota_used, quota_remaining, checked_at, error),
          alerts(id, level, message, created_at)
        `)
        .eq('id', id)
        .single()

      if (data) {
        const d = data as any
        setChannel({
          id: d.id,
          channel_name: d.channel_name,
          channel_id: d.channel_id,
          quota_limit: d.quota_limit,
          active: d.active,
          webhook_status: d.webhook_status ?? 'unknown',
          webhook_checked_at: d.webhook_checked_at ?? null,
          provider: Array.isArray(d.provider) ? d.provider[0] : d.provider,
          latest_log: d.latest_log?.sort((a: any, b: any) =>
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
        setDailyLogs(
          (logs as any[]).map((l) => ({
            checked_at: new Date(l.checked_at).toLocaleDateString(),
            quota_used: l.quota_used,
          }))
        )
      }

      setLoading(false)
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
    return <div className="text-center py-12 text-muted-foreground">Channel not found</div>
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
      case 'normal': return <Badge variant="secondary">Recovery</Badge>
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
        <p className="text-muted-foreground font-mono text-sm">{channel.channel_id}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xl font-bold">{channel.quota_limit.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Quota Limit</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xl font-bold">
              {channel.latest_log ? channel.latest_log.quota_used.toLocaleString() : '-'}
            </div>
            <p className="text-xs text-muted-foreground">Used</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xl font-bold">
              {channel.latest_log && !channel.latest_log.error
                ? channel.latest_log.quota_remaining.toLocaleString()
                : '-'}
            </div>
            <p className="text-xs text-muted-foreground">Remaining</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xl font-bold">{usagePct.toFixed(1)}%</div>
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
                <p className="text-center py-8 text-muted-foreground">No data yet. Collector will start populating after first run.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyLogs}>
                    <XAxis dataKey="checked_at" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Line type="monotone" dataKey="quota_used" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
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
                    <p className="text-2xl font-bold">{forecast.daysLeft} days</p>
                  </div>
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">
                  {channel.latest_log && channel.latest_log.quota_used === 0
                    ? 'Not enough data (current usage is 0). Data will build throughout the month.'
                    : 'No data available yet.'}
                </p>
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
                <p className="text-center py-8 text-muted-foreground">No alerts yet</p>
              ) : (
                <div className="space-y-2">
                  {channel.alerts.map((alert) => (
                    <div key={alert.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        {alertBadge(alert.level)}
                        <span className="ml-2 text-sm">{alert.message}</span>
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Webhook Status</CardTitle>
              <WebhookTestButton channelId={channel.id} />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    channel.webhook_status === 'online'
                      ? 'bg-green-500'
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
          {result}
        </Badge>
      )}
      <Button size="sm" variant="outline" onClick={test} disabled={testing}>
        {testing ? 'Testing...' : 'Test Now'}
      </Button>
    </div>
  )
}
