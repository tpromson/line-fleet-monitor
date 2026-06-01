import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'

interface OrgCounts {
  orgs: number
  providers: number
  channels: number
  totalUsed: number
  totalRemaining: number
  criticalCount: number
}

interface ChannelSummary {
  id: string
  channel_name: string
  quota_limit: number
  latest_log: { quota_used: number; quota_remaining: number } | null
  latest_alert: { level: string } | null
}

interface ProviderRow {
  id: string
  name: string
  organization: { id: string; name: string }
  channels: ChannelSummary[]
}

function buildCounts(providers: ProviderRow[]): OrgCounts {
  const orgSet = new Set<string>()
  let channels = 0
  let totalUsed = 0
  let totalRemaining = 0
  let criticalCount = 0

  for (const p of providers) {
    orgSet.add(p.organization.id)
    for (const c of p.channels) {
      channels++
      if (c.latest_log) {
        totalUsed += c.latest_log.quota_used
        totalRemaining += c.latest_log.quota_remaining
      }
      if (c.latest_alert?.level === 'critical') criticalCount++
    }
  }

  return {
    orgs: orgSet.size,
    providers: providers.length,
    channels,
    totalUsed,
    totalRemaining,
    criticalCount,
  }
}

function getChannelStatus(channel: ChannelSummary) {
  if (!channel.latest_log) return 'no-data'
  const pct = (channel.latest_log.quota_used / channel.quota_limit) * 100
  if (pct >= 95) return 'critical'
  if (pct >= 80) return 'warning'
  return 'normal'
}

export function DashboardPage() {
  const { isSuperAdmin } = useAuth()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('providers')
        .select(`
          id, name,
          organization:organization_id (id, name),
          channels (
            id, channel_name, quota_limit,
            latest_log:quota_logs(quota_used, quota_remaining),
            latest_alert:alerts(level)
          )
        `)
        .order('name')

      if (data) {
        const mapped: ProviderRow[] = (data as any[]).map((p) => ({
          id: p.id,
          name: p.name,
          organization: Array.isArray(p.organization) ? p.organization[0] : p.organization,
          channels: (p.channels || []).map((c: any) => ({
            id: c.id,
            channel_name: c.channel_name,
            quota_limit: c.quota_limit,
            latest_log: c.latest_log?.[0] ?? null,
            latest_alert: c.latest_alert?.[0] ?? null,
          })),
        }))
        setProviders(mapped)
      }
      setLoading(false)
    }
    load()
  }, [])

  const counts = buildCounts(providers)

  const statusBadge = (status: string) => {
    switch (status) {
      case 'critical': return <Badge variant="destructive">Critical</Badge>
      case 'warning': return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">Warning</Badge>
      case 'normal': return <Badge variant="secondary">Normal</Badge>
      default: return <Badge variant="outline">No Data</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">Overview of all your LINE channels</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-8 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{counts.orgs}</div>
              <p className="text-xs text-muted-foreground">Organizations</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{counts.providers}</div>
              <p className="text-xs text-muted-foreground">Providers</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{counts.channels}</div>
              <p className="text-xs text-muted-foreground">Channels</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{counts.totalUsed.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Used</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{counts.totalRemaining.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Remaining</p>
            </CardContent>
          </Card>
          <Card className={counts.criticalCount > 0 ? 'border-destructive' : ''}>
            <CardContent className="pt-6">
              <div className={`text-2xl font-bold ${counts.criticalCount > 0 ? 'text-destructive' : ''}`}>
                {counts.criticalCount}
              </div>
              <p className="text-xs text-muted-foreground">Critical</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Providers</h3>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : providers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No channels found.{' '}
              {isSuperAdmin && (
                <Link to="/setup" className="text-primary underline">Set up your first channel</Link>
              )}
            </CardContent>
          </Card>
        ) : (
          providers.map((provider) => (
            <Card key={provider.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      <Link to={`/providers/${provider.id}`} className="hover:underline">
                        {provider.name}
                      </Link>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{provider.organization.name}</p>
                  </div>
                  <Badge variant="outline">{provider.channels.length} channels</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {provider.channels.map((channel) => (
                    <div key={channel.id} className="flex items-center justify-between text-sm">
                      <Link
                        to={`/channels/${channel.id}`}
                        className="text-foreground hover:underline"
                      >
                        {channel.channel_name}
                      </Link>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground font-mono">
                          {channel.latest_log ? `${channel.latest_log.quota_used.toLocaleString()}/${channel.quota_limit.toLocaleString()}` : '- / -'}
                        </span>
                        {statusBadge(getChannelStatus(channel))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
