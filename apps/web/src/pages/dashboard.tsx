import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { fetchBackend } from '@/lib/backend-api'
import { StatCard } from '@/components/stat-card'
import { toast } from 'sonner'
import { Building2, Radio, MessageSquare, ArrowUpFromLine, ArrowDownToLine, Flame, ChevronDown, ChevronRight } from 'lucide-react'

interface ChannelSummary {
  id: string
  channel_name: string
  quota_limit: number
  latest_log: { quota_used: number; quota_remaining: number; checked_at: string } | null
  latest_alert: { level: string } | null
}

interface ProviderRow {
  id: string
  name: string
  organization: { id: string; name: string }
  channels: ChannelSummary[]
}

interface OrgGroup {
  org: { id: string; name: string }
  providers: ProviderRow[]
}

interface QuotaLogRow {
  checked_at: string
  quota_used: number
  quota_remaining: number
}

interface ProviderRowData {
  id: string
  name: string
  organization: { id: string; name: string } | { id: string; name: string }[]
  channels: Array<{
    id: string
    channel_name: string
    quota_limit: number
    latest_log?: QuotaLogRow[]
    latest_alert?: { level: string }[]
  }>
}

export function DashboardPage() {
  const { isSuperAdmin } = useAuth()
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [compact, setCompact] = useState(false)
  const [collapsedOrgs, setCollapsedOrgs] = useState<Set<string>>(new Set())

  const lastSyncTime = providers
    .flatMap((p) => p.channels)
    .map((c) => c.latest_log?.checked_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0]

  const loadDashboard = useCallback(async () => {
    try {
      setError(null)
      const { data, error: fetchError } = await supabase
        .from('providers')
        .select(`
          id, name,
          organization:organization_id (id, name),
          channels (
            id, channel_name, quota_limit,
            latest_log:quota_logs(quota_used, quota_remaining, checked_at).order(checked_at.desc).limit(1),
            latest_alert:alerts(level).order(created_at.desc).limit(1)
          )
        `)
        .order('name')

      if (fetchError) throw new Error(fetchError.message)

      if (data) {
        setProviders((data as unknown as ProviderRowData[]).map((p) => ({
          id: p.id,
          name: p.name,
          organization: Array.isArray(p.organization) ? p.organization[0] : p.organization,
          channels: (p.channels || []).map((c) => ({
            id: c.id,
            channel_name: c.channel_name,
            quota_limit: c.quota_limit,
            latest_log: c.latest_log?.sort((a, b) =>
              new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime()
            )[0] ?? null,
            latest_alert: c.latest_alert?.[0] ?? null,
          })),
        })))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling pattern: loads data on interval
    loadDashboard()
    const interval = setInterval(() => { loadDashboard() }, 300000)
    return () => clearInterval(interval)
  }, [loadDashboard])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await fetchBackend('/api/sync', { method: 'POST' })
      toast.success('Sync started — refreshing...')
      setTimeout(() => { loadDashboard() }, 5000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cannot reach backend')
    } finally { setSyncing(false) }
  }

  // Compute counts
  const orgSet = new Set(providers.map((p) => p.organization.id))
  let totalChannels = 0, totalUsed = 0, totalRemaining = 0, criticalCount = 0
  for (const p of providers) {
    for (const c of p.channels) {
      totalChannels++
      if (c.latest_log) { totalUsed += c.latest_log.quota_used; totalRemaining += c.latest_log.quota_remaining }
      if (c.latest_alert?.level === 'critical') criticalCount++
    }
  }

  // Group by Organization
  const orgGroups: OrgGroup[] = []
  const orgMap = new Map<string, OrgGroup>()
  for (const p of providers) {
    let group = orgMap.get(p.organization.id)
    if (!group) {
      group = { org: p.organization, providers: [] }
      orgMap.set(p.organization.id, group)
      orgGroups.push(group)
    }
    group.providers.push(p)
  }

  const toggleOrg = (id: string) => {
    setCollapsedOrgs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const getStatus = (channel: ChannelSummary) => {
    if (!channel.latest_log) return 'no-data'
    const pct = (channel.latest_log.quota_used / channel.quota_limit) * 100
    if (pct >= 95) return 'critical'
    if (pct >= 80) return 'warning'
    return 'recovery'
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'critical': return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-200 border-rose-200">Crit</Badge>
      case 'warning': return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200">Warn</Badge>
      case 'recovery': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200">OK</Badge>
      default: return <Badge variant="outline">-</Badge>
    }
  }

  const providerHasIssue = (pr: ProviderRow) =>
    pr.channels.some((c) => getStatus(c) !== 'recovery' && getStatus(c) !== 'no-data')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground text-xs">
            {lastSyncTime
              ? `Last sync: ${new Date(lastSyncTime).toLocaleString()}`
              : 'No data yet'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCompact(!compact)}>
            {compact ? 'Compact' : 'Expand All'}
          </Button>
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-3"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive">
          <CardContent className="py-6 text-center">
            <p className="text-destructive font-medium">Failed to load dashboard</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={loadDashboard}>Retry</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={<Building2 className="w-4 h-4" />} value={String(orgSet.size)} label="Organizations" />
          <StatCard icon={<Radio className="w-4 h-4" />} value={String(providers.length)} label="Providers" />
          <StatCard icon={<MessageSquare className="w-4 h-4" />} value={String(totalChannels)} label="Channels" />
          <StatCard icon={<ArrowUpFromLine className="w-4 h-4" />} value={totalUsed.toLocaleString()} label="Used" />
          <StatCard icon={<ArrowDownToLine className="w-4 h-4" />} value={totalRemaining.toLocaleString()} label="Remaining" />
          <StatCard icon={<Flame className="w-4 h-4" />} value={String(criticalCount)} label="Critical" warn={criticalCount > 0} />
        </div>
      )}

      <div className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : providers.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No channels found.{' '}
              {isSuperAdmin && <Link to="/setup" className="text-primary underline">Set up your first channel</Link>}
            </CardContent>
          </Card>
        ) : (
          orgGroups.map((group) => {
            const collapsed = collapsedOrgs.has(group.org.id)
            return (
              <div key={group.org.id}>
                <button
                  onClick={() => toggleOrg(group.org.id)}
                  aria-expanded={!collapsed}
                  aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.org.name}`}
                  className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground mb-3 w-full text-left focus-visible:outline-2 focus-visible:outline-primary rounded"
                >
                  {collapsed
                    ? <ChevronRight className="w-4 h-4 shrink-0" />
                    : <ChevronDown className="w-4 h-4 shrink-0" />
                  }
                  <span className="truncate">{group.org.name}</span>
                  <span className="font-normal text-xs shrink-0">
                    ({group.providers.length} providers)
                  </span>
                </button>

                {!collapsed && (
                  <div className="space-y-3 ml-4">
                    {group.providers.map((provider) => {
                      const showCompact = compact && !providerHasIssue(provider)
                      return (
                        <Card key={provider.id} className={showCompact ? 'opacity-70' : ''}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm font-medium">
                                <Link to={`/providers/${provider.id}`} className="hover:underline">
                                  {provider.name}
                                </Link>
                              </CardTitle>
                              <Badge variant="outline" className="text-xs">{provider.channels.length}</Badge>
                            </div>
                          </CardHeader>
                          {!showCompact && (
                            <CardContent className="pt-0">
                              <div className="space-y-1">
                                {provider.channels.map((channel) => {
                                  const status = getStatus(channel)
                                  const pct = channel.latest_log
                                    ? Math.round((channel.latest_log.quota_used / channel.quota_limit) * 100)
                                    : 0
                                  const barColor =
                                    status === 'critical' ? 'bg-rose-400'
                                    : status === 'warning' ? 'bg-amber-400'
                                    : 'bg-emerald-400'

                                  return (
                                    <Link
                                      key={channel.id}
                                      to={`/channels/${channel.id}`}
                                      className="flex items-center gap-3 text-sm py-1 hover:bg-muted/50 rounded px-2 -mx-2 transition-colors"
                                    >
                                      <span className="w-28 shrink-0 truncate">{channel.channel_name}</span>
                                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all ${barColor}`}
                                          style={{ width: `${Math.min(pct, 100)}%` }}
                                        />
                                      </div>
                                      <span className="w-24 text-right font-mono text-xs shrink-0">
                                        {channel.latest_log
                                          ? `${channel.latest_log.quota_used.toLocaleString()}/${channel.quota_limit.toLocaleString()}`
                                          : '- / -'}
                                      </span>
                                      <span className="w-10 shrink-0">{statusBadge(status)}</span>
                                    </Link>
                                  )
                                })}
                              </div>
                            </CardContent>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
