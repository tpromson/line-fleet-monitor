import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { AlertCircle, Hash, TrendingUp, Gauge, Activity } from 'lucide-react'

interface ChannelItem {
  id: string
  channel_name: string
  channel_id: string
  quota_limit: number
  latest_log: { quota_used: number; quota_remaining: number; checked_at: string; error: string | null } | null
  latest_alert: { level: string } | null
}

interface ProviderDetail {
  id: string
  name: string
  organization: { id: string; name: string }
  channels: ChannelItem[]
}

function statusBadge(channel: ChannelItem) {
  if (!channel.latest_log) return <Badge variant="outline">No Data</Badge>
  if (channel.latest_log.error) return <Badge variant="destructive">Error</Badge>
  const pct = (channel.latest_log.quota_used / channel.quota_limit) * 100
  if (pct >= 95) return <Badge variant="destructive">Critical ({pct.toFixed(0)}%)</Badge>
  if (pct >= 80) return <Badge className="bg-yellow-500 text-white">Warning ({pct.toFixed(0)}%)</Badge>
  return <Badge variant="secondary">{pct.toFixed(0)}%</Badge>
}

export function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [provider, setProvider] = useState<ProviderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        setError(null)
        const { data, error: fetchError } = await supabase
          .from('providers')
          .select(`
            id, name,
            organization:organization_id (id, name),
            channels (
              id, channel_name, channel_id, quota_limit,
              latest_log:quota_logs(quota_used, quota_remaining, checked_at, error),
              latest_alert:alerts(level)
            )
          `)
          .eq('id', id)
          .single()

        if (fetchError) throw new Error(fetchError.message)

        if (data) {
          const d = data as any
          setProvider({
            id: d.id,
            name: d.name,
            organization: Array.isArray(d.organization) ? d.organization[0] : d.organization,
            channels: (d.channels || []).map((c: any) => ({
              id: c.id,
              channel_name: c.channel_name,
              channel_id: c.channel_id,
              quota_limit: c.quota_limit,
              latest_log: c.latest_log?.sort((a: any, b: any) =>
                new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime()
              )[0] ?? null,
              latest_alert: c.latest_alert?.[0] ?? null,
            })),
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load provider')
      } finally {
        setLoading(false)
      }
    }
    if (id) load()
  }, [id])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <p className="text-destructive font-medium">Failed to load provider</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
      </div>
    )
  }

  if (!provider) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">Provider not found</p>
        <Link to="/dashboard" className="text-sm text-primary hover:underline mt-2 inline-block">&larr; Back to Dashboard</Link>
      </div>
    )
  }

  const totalUsed = provider.channels.reduce((sum, c) => sum + (c.latest_log?.quota_used ?? 0), 0)
  const totalLimit = provider.channels.reduce((sum, c) => sum + c.quota_limit, 0)

  return (
    <div className="space-y-6">
      <div>
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">&larr; Dashboard</Link>
        <h2 className="text-2xl font-bold tracking-tight mt-1">{provider.name}</h2>
        <p className="text-muted-foreground">{provider.organization.name}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xl font-bold">{provider.channels.length}</div>
            <p className="text-xs text-muted-foreground">Channels</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xl font-bold">{totalUsed.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total Used</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xl font-bold">{totalLimit.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total Limit</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xl font-bold">
              {totalLimit > 0 ? `${((totalUsed / totalLimit) * 100).toFixed(1)}%` : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">Overall Usage</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent>
          {provider.channels.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground">No channels in this provider</p>
          ) : (
            <div className="space-y-2">
              {provider.channels.map((channel) => (
                <div key={channel.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <Link to={`/channels/${channel.id}`} className="font-medium hover:underline">
                      {channel.channel_name}
                    </Link>
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-64">{channel.channel_id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground font-mono">
                      {channel.latest_log
                        ? `${channel.latest_log.quota_used.toLocaleString()}/${channel.quota_limit.toLocaleString()}`
                        : '- / -'}
                    </span>
                    {statusBadge(channel)}
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
