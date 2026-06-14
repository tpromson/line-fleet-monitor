import { supabase } from './lib/supabase.js'
import { sendAlertEmail } from './lib/email.js'

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.split(',').map((e) => e.trim()).filter(Boolean) ?? []

function yesterdayRange() {
  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = new Date(end.getTime() - 86400000)
  return { start, end }
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
}

export async function sendDailyReport() {
  const { start, end } = yesterdayRange()
  console.log(`[daily-report] Generating report for ${start.toISOString()} – ${end.toISOString()}`)

  if (ALERT_EMAIL_TO.length === 0) {
    console.log('[daily-report] No recipients configured, skipping')
    return
  }

  const sections: string[] = []
  const dateLabel = fmtDate(start)

  const [orgsRes, channelsRes, latestLogsRes] = await Promise.all([
    supabase.from('organizations').select('id, name').order('name'),
    supabase.from('channels').select('id, channel_name, quota_limit').eq('active', true).order('channel_name'),
    supabase
      .from('quota_logs')
      .select('channel_id, quota_used, quota_limit, quota_remaining, checked_at')
      .is('error', null)
      .order('checked_at', { ascending: false })
      .limit(200),
  ])

  const orgs = orgsRes.data ?? []
  const channels = channelsRes.data ?? []
  const allLogs = latestLogsRes.data ?? []

  const logByChannel = new Map<string, typeof allLogs[0]>()
  for (const log of allLogs) {
    if (!logByChannel.has(log.channel_id)) {
      logByChannel.set(log.channel_id, log)
    }
  }

  // LINE Quota section
  if (channels.length > 0) {
    const quotaLines: string[] = []
    let totalUsed = 0
    let totalLimit = 0
    for (const ch of channels) {
      const log = logByChannel.get(ch.id)
      const used = log?.quota_used ?? 0
      const limit = log?.quota_limit ?? ch.quota_limit
      const pct = limit > 0 ? ((used / limit) * 100).toFixed(1) : '-'
      quotaLines.push(`   ${ch.channel_name}: ${used.toLocaleString()} / ${limit.toLocaleString()} (${pct}%)`)
      totalUsed += used
      totalLimit += limit
    }
    const totalPct = totalLimit > 0 ? ((totalUsed / totalLimit) * 100).toFixed(1) : '-'
    quotaLines.push(`   ─────────────────`)
    quotaLines.push(`   รวม: ${totalUsed.toLocaleString()} / ${totalLimit.toLocaleString()} (${totalPct}%)`)
    sections.push(`🔸 LINE Quota\n${quotaLines.join('\n')}`)
  }

  // IoT sources grouped by org
  for (const org of orgs) {
    const { data: sources } = await supabase
      .from('sources')
      .select('id, name, metadata')
      .eq('organization_id', org.id)
      .eq('active', true)
      .order('name')

    if (!sources || sources.length === 0) continue

    const sourceIds = sources.map((s) => s.id)

    const [{ data: events }, { data: devices }] = await Promise.all([
      supabase
        .from('events')
        .select('source_id, event_type, level, payload, created_at')
        .in('source_id', sourceIds)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('devices')
        .select('source_id, status')
        .in('source_id', sourceIds),
    ])

    const allEvents = events ?? []
    const allDevices = devices ?? []

    const orgLines: string[] = []
    for (const src of sources) {
      const srcEvents = allEvents.filter((e) => e.source_id === src.id)
      const group = (src.metadata as Record<string, unknown> | null)?.group
      const label = group ? `${src.name} [${group}]` : src.name

      if (srcEvents.length === 0) {
        orgLines.push(`   ${label}: no events`)
        continue
      }

      // Temperature stats from TEMP_NORMAL / HIGH_TEMP events
      const tempEvents = srcEvents.filter((e) => e.event_type === 'TEMP_NORMAL' || e.event_type === 'HIGH_TEMP')
      const temps = tempEvents
        .map((e) => {
          const p = e.payload as Record<string, unknown>
          return (p.temperature ?? p.lastTemperature) as number | undefined
        })
        .filter((t): t is number => typeof t === 'number' && !isNaN(t))

      let tempLine = ''
      if (temps.length > 0) {
        const max = Math.max(...temps)
        const min = Math.min(...temps)
        const avg = temps.reduce((a, b) => a + b, 0) / temps.length
        tempLine = ` max ${max.toFixed(1)}°C / min ${min.toFixed(1)}°C / avg ${avg.toFixed(1)}°C`
      }

      // Event type breakdown
      const typeCount = new Map<string, number>()
      for (const e of srcEvents) {
        typeCount.set(e.event_type, (typeCount.get(e.event_type) ?? 0) + 1)
      }
      const breakdown = [...typeCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${t}: ${c}`)
        .join(', ')

      // Device status
      const srcDevices = allDevices.filter((d) => d.source_id === src.id)
      const online = srcDevices.filter((d) => d.status === 'online').length
      const offline = srcDevices.filter((d) => d.status === 'offline').length

      let line = `   ${label}:${tempLine}`
      line += `\n     events: ${srcEvents.length} (${breakdown})`
      line += `\n     devices: ${online} online${offline > 0 ? `, ${offline} offline` : ''}`
      orgLines.push(line)
    }

    if (orgLines.length > 0) {
      sections.push(`🔸 ${org.name}\n${orgLines.join('\n')}`)
    }
  }

  if (sections.length === 0) {
    console.log('[daily-report] No data to report')
    return
  }

  const subject = `[LINE Fleet] Daily Report — ${dateLabel}`
  const body = sections.join('\n\n')
  await sendAlertEmail(ALERT_EMAIL_TO, subject, body)
  console.log('[daily-report] Report sent')
}
