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

type ChannelQuota = { name: string; used: number; limit: number; pct: number }
type SourceStats = {
  name: string
  group: string | null
  eventCount: number
  temps: { max: number; min: number; avg: number } | null
  breakdown: Array<{ type: string; count: number; maxLevel: 'critical' | 'warning' }>
  online: number
  offline: number
}
type OrgStats = { name: string; sources: SourceStats[] }
type HourlyAlert = { hour: number; critical: number; warning: number }
type ReportData = {
  dateLabel: string
  generatedAt: string
  channels: ChannelQuota[]
  totalUsed: number
  totalLimit: number
  totalPct: number
  orgs: OrgStats[]
  hourlyAlerts: HourlyAlert[]
  hasData: boolean
}

async function collectReportData(): Promise<ReportData> {
  const { start, end } = yesterdayRange()
  const dateLabel = fmtDate(start)
  const generatedAt = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

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

  const hourlyAlerts: HourlyAlert[] = Array.from({ length: 24 }, (_, hour) => ({ hour, critical: 0, warning: 0 }))
  const bangkokFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
  function bucketAlert(createdAt: string, level: string | null) {
    if (level !== 'critical' && level !== 'warning') return
    const hour = parseInt(bangkokFmt.format(new Date(createdAt)), 10)
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return
    if (level === 'critical') hourlyAlerts[hour].critical++
    else hourlyAlerts[hour].warning++
  }

  const logByChannel = new Map<string, typeof allLogs[0]>()
  for (const log of allLogs) {
    if (!logByChannel.has(log.channel_id)) logByChannel.set(log.channel_id, log)
  }

  const channelQuotas: ChannelQuota[] = channels.map((ch) => {
    const log = logByChannel.get(ch.id)
    const used = log?.quota_used ?? 0
    const limit = log?.quota_limit ?? ch.quota_limit
    return { name: ch.channel_name, used, limit, pct: limit > 0 ? (used / limit) * 100 : 0 }
  })

  const totalUsed = channelQuotas.reduce((s, c) => s + c.used, 0)
  const totalLimit = channelQuotas.reduce((s, c) => s + c.limit, 0)
  const totalPct = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0

  const orgStats: OrgStats[] = []
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
      supabase.from('devices').select('source_id, status').in('source_id', sourceIds),
    ])

    const allEvents = events ?? []
    const allDevices = devices ?? []
    for (const e of allEvents) bucketAlert(e.created_at, e.level)

    const srcStats: SourceStats[] = []
    for (const src of sources) {
      const srcAllEvents = allEvents.filter((e) => e.source_id === src.id)
      const srcEvents = srcAllEvents.filter((e) => e.level === 'critical' || e.level === 'warning')
      const group = (src.metadata as Record<string, unknown> | null)?.group as string | undefined
      const temps = srcAllEvents
        .filter((e) => e.event_type === 'TEMP_NORMAL' || e.event_type === 'HIGH_TEMP')
        .map((e) => {
          const p = e.payload as Record<string, unknown>
          return (p.temperature ?? p.lastTemperature) as number | undefined
        })
        .filter((t): t is number => typeof t === 'number' && !isNaN(t))

      const typeCount = new Map<string, { count: number; maxLevel: 'critical' | 'warning' }>()
      for (const e of srcEvents) {
        const prev = typeCount.get(e.event_type)
        const lvl = e.level === 'critical' ? 'critical' : 'warning'
        if (!prev) typeCount.set(e.event_type, { count: 1, maxLevel: lvl })
        else if (lvl === 'critical') { prev.count++; prev.maxLevel = 'critical' }
        else { prev.count++ }
      }
      const breakdown = [...typeCount.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([type, { count, maxLevel }]) => ({ type, count, maxLevel }))

      const srcDevices = allDevices.filter((d) => d.source_id === src.id)
      const online = srcDevices.filter((d) => d.status === 'online').length
      const offline = srcDevices.filter((d) => d.status === 'offline').length

      srcStats.push({
        name: src.name,
        group: group ?? null,
        eventCount: srcEvents.length,
        temps: temps.length > 0
          ? { max: Math.max(...temps), min: Math.min(...temps), avg: temps.reduce((a, b) => a + b, 0) / temps.length }
          : null,
        breakdown,
        online,
        offline,
      })
    }

    orgStats.push({ name: org.name, sources: srcStats })
  }

  const hasData = channelQuotas.length > 0 || orgStats.length > 0
  return { dateLabel, generatedAt, channels: channelQuotas, totalUsed, totalLimit, totalPct, orgs: orgStats, hourlyAlerts, hasData }
}

function pctColor(pct: number): { bg: string; fg: string; label: string } {
  if (pct >= 95) return { bg: '#fee2e2', fg: '#991b1b', label: 'CRITICAL' }
  if (pct >= 80) return { bg: '#fef3c7', fg: '#92400e', label: 'WARNING' }
  if (pct > 0) return { bg: '#d1fae5', fg: '#065f46', label: 'OK' }
  return { bg: '#f3f4f6', fg: '#6b7280', label: '—' }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function buildAlertTimeline(hourly: HourlyAlert[]): { svg: string; totalCritical: number; totalWarning: number; peakHour: number | null } {
  const W = 720
  const H = 140
  const barW = 24
  const gap = 6
  const step = barW + gap
  const chartH = 90
  const baseline = 110

  const totalCritical = hourly.reduce((s, h) => s + h.critical, 0)
  const totalWarning = hourly.reduce((s, h) => s + h.warning, 0)
  const max = Math.max(1, ...hourly.map((h) => h.critical + h.warning))
  const peakIdx = hourly.findIndex((h) => h.critical + h.warning === max && max > 0)
  const scale = (count: number) => (count / max) * chartH

  const bars = hourly
    .map((h, i) => {
      const x = i * step + gap / 2
      const cH = scale(h.critical)
      const wH = scale(h.warning)
      const cY = baseline - cH
      const wY = cY - wH
      const isPeak = i === peakIdx
      const labelColor = h.critical + h.warning === 0 ? '#d1d5db' : isPeak ? '#111827' : '#6b7280'
      const labelWeight = isPeak ? '600' : '400'
      return `<g>
        <rect x="${x}" y="${wY}" width="${barW}" height="${wH}" fill="#d97706" rx="2"/>
        <rect x="${x}" y="${cY}" width="${barW}" height="${cH}" fill="#dc2626" rx="2"/>
        <text x="${x + barW / 2}" y="${baseline + 14}" text-anchor="middle" font-size="9" fill="${labelColor}" font-weight="${labelWeight}">${String(h.hour).padStart(2, '0')}</text>
      </g>`
    })
    .join('')

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto;" preserveAspectRatio="xMidYMid meet">
    <line x1="0" y1="${baseline}" x2="${W}" y2="${baseline}" stroke="#e5e7eb" stroke-width="1"/>
    ${bars}
  </svg>`

  return { svg, totalCritical, totalWarning, peakHour: peakIdx >= 0 ? peakIdx : null }
}

function buildTextReport(d: ReportData): string {
  const sections: string[] = []

  if (d.channels.length > 0) {
    const quotaLines = d.channels.map((c) => `   ${c.name}: ${c.used.toLocaleString()} / ${c.limit.toLocaleString()} (${c.pct.toFixed(1)}%)`)
    quotaLines.push(`   ─────────────────`)
    quotaLines.push(`   รวม: ${d.totalUsed.toLocaleString()} / ${d.totalLimit.toLocaleString()} (${d.totalPct.toFixed(1)}%)`)
    sections.push(`🔸 LINE Quota\n${quotaLines.join('\n')}`)
  }

  const tlCrit = d.hourlyAlerts.reduce((s, h) => s + h.critical, 0)
  const tlWarn = d.hourlyAlerts.reduce((s, h) => s + h.warning, 0)
  if (tlCrit + tlWarn > 0) {
    const peak = d.hourlyAlerts.reduce((best, h, i) => (h.critical + h.warning > best.count ? { count: h.critical + h.warning, hour: i } : best), { count: 0, hour: -1 })
    const timelineLines = d.hourlyAlerts
      .filter((h) => h.critical + h.warning > 0)
      .map((h) => {
        const idx = d.hourlyAlerts.indexOf(h)
        const bar = '█'.repeat(h.critical) + '▒'.repeat(h.warning)
        return `   ${String(idx).padStart(2, '0')}:00  ${bar.padEnd(20, ' ')} (C:${h.critical} W:${h.warning})`
      })
    sections.push(`⏰ Alert Timeline (${tlCrit} critical, ${tlWarn} warning, peak ${String(peak.hour).padStart(2, '0')}:00)\n${timelineLines.join('\n')}`)
  }

  for (const org of d.orgs) {
    const orgLines: string[] = []
    for (const s of org.sources) {
      const label = s.group ? `${s.name} [${s.group}]` : s.name
      let line = `   ${label}:`
      if (s.temps) line += ` max ${s.temps.max.toFixed(1)}°C / min ${s.temps.min.toFixed(1)}°C / avg ${s.temps.avg.toFixed(1)}°C`
      if (s.breakdown.length > 0) {
        line += `\n     alerts: ${s.eventCount} (${s.breakdown.map((b) => `${b.type}: ${b.count}`).join(', ')})`
      } else {
        line += `\n     alerts: none`
      }
      line += `\n     devices: ${s.online} online${s.offline > 0 ? `, ${s.offline} offline` : ''}`
      orgLines.push(line)
    }
    if (orgLines.length > 0) sections.push(`🔸 ${org.name}\n${orgLines.join('\n')}`)
  }

  return sections.join('\n\n')
}

function buildHtmlReport(d: ReportData): string {
  const totalC = pctColor(d.totalPct)
  const totalDevices = d.orgs.reduce(
    (acc, o) => {
      for (const s of o.sources) { acc.online += s.online; acc.offline += s.offline }
      return acc
    },
    { online: 0, offline: 0 }
  )
  const totalDevs = totalDevices.online + totalDevices.offline

  const channelRows = d.channels
    .map((c) => {
      const col = pctColor(c.pct)
      return `<tr>
  <td style="padding:10px 0;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;">${esc(c.name)}</td>
  <td align="right" style="padding:10px 0;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${c.used.toLocaleString()} / ${c.limit.toLocaleString()}</td>
  <td align="right" style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
    <span style="background:${col.bg};color:${col.fg};padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;">${c.pct.toFixed(1)}%</span>
  </td>
</tr>`
    })
    .join('')

  const quotaSection = d.channels.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-bottom:1px solid #e5e7eb;">
        <tr>
          <td style="padding:20px 24px 8px 24px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">💬 LINE Quota</td>
        </tr>
        <tr>
          <td style="padding:0 24px 20px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <th align="left" style="padding:8px 0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e5e7eb;">Channel</th>
                <th align="right" style="padding:8px 0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e5e7eb;">Used / Limit</th>
                <th align="right" style="padding:8px 0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e5e7eb;">Usage</th>
              </tr>
              ${channelRows}
              <tr>
                <td style="padding:12px 0 0 0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Total</td>
                <td align="right" style="padding:12px 0 0 0;font-size:12px;color:#6b7280;">${d.totalUsed.toLocaleString()} / ${d.totalLimit.toLocaleString()}</td>
                <td align="right" style="padding:12px 0 0 0;">
                  <span style="background:${totalC.bg};color:${totalC.fg};padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;">${d.totalPct.toFixed(1)}%</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`
    : ''

  const timeline = buildAlertTimeline(d.hourlyAlerts)
  const peakLabel = timeline.peakHour !== null
    ? `<span style="font-size:11px;color:#6b7280;">peak: ${String(timeline.peakHour).padStart(2, '0')}:00</span>`
    : ''
  const timelineSection = (timeline.totalCritical + timeline.totalWarning) > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-bottom:1px solid #e5e7eb;">
        <tr>
          <td style="padding:20px 24px 8px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">⏰ Alert Timeline</td>
              <td align="right">${peakLabel}</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 4px 24px;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:11px;color:#6b7280;">
                <span style="display:inline-block;width:8px;height:8px;background:#dc2626;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>${timeline.totalCritical} critical
                <span style="display:inline-block;width:8px;height:8px;background:#d97706;border-radius:2px;vertical-align:middle;margin:0 4px 0 14px;"></span>${timeline.totalWarning} warning
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 20px 24px;">${timeline.svg}</td>
        </tr>
      </table>`
    : ''

  const orgSections = d.orgs
    .map((org) => {
      const sourceBlocks = org.sources
        .map((s) => {
          const label = s.group ? `${s.name} <span style="color:#9ca3af;font-weight:400;">[${esc(s.group)}]</span>` : esc(s.name)
          const tempLine = s.temps
            ? `<div style="font-size:12px;color:#6b7280;margin-top:6px;">🌡️ max <strong style="color:#111827;">${s.temps.max.toFixed(1)}°C</strong> · min ${s.temps.min.toFixed(1)}°C · avg ${s.temps.avg.toFixed(1)}°C</div>`
            : ''
          const breakdownLine = s.breakdown.length > 0
            ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">📊 ${s.eventCount} events · ${s.breakdown.map((b) => {
                const c = b.maxLevel === 'critical' ? '#dc2626' : '#d97706'
                return `<span style="color:${c};font-weight:600;">${esc(b.type)}: ${b.count}</span>`
              }).join(', ')}</div>`
            : `<div style="font-size:12px;color:#10b981;margin-top:4px;">📊 0 events</div>`
          const devLine = (s.online + s.offline) > 0
            ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">
                <span style="color:#10b981;">●</span> ${s.online} online${s.offline > 0 ? ` <span style="color:#ef4444;">●</span> ${s.offline} offline` : ''}
              </div>`
            : ''
          return `<div style="background:#f9fafb;padding:12px 14px;border-radius:6px;margin-bottom:6px;border:1px solid #f3f4f6;">
            <div style="font-size:13px;font-weight:600;color:#111827;">${label}</div>
            ${tempLine}${breakdownLine}${devLine}
          </div>`
        })
        .join('')

      return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-bottom:1px solid #e5e7eb;">
        <tr>
          <td style="padding:20px 24px 8px 24px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">🌡️ ${esc(org.name)}</td>
        </tr>
        <tr>
          <td style="padding:0 24px 20px 24px;">${sourceBlocks}</td>
        </tr>
      </table>`
    })
    .join('')

  const summary = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-bottom:1px solid #e5e7eb;">
      <tr>
        <td width="33%" align="center" style="padding:20px 12px;">
          <div style="font-size:28px;font-weight:700;color:#111827;line-height:1;">${d.channels.length}</div>
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:6px;">Channels</div>
        </td>
        <td width="33%" align="center" style="padding:20px 12px;border-left:1px solid #f3f4f6;border-right:1px solid #f3f4f6;">
          <div style="font-size:28px;font-weight:700;color:${totalC.fg};line-height:1;">${d.totalPct.toFixed(0)}%</div>
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:6px;">Total Quota</div>
        </td>
        <td width="33%" align="center" style="padding:20px 12px;">
          <div style="font-size:28px;font-weight:700;color:${totalDevices.offline > 0 ? '#ef4444' : '#10b981'};line-height:1;">${totalDevices.online}<span style="font-size:14px;color:#9ca3af;font-weight:400;">/${totalDevs || 0}</span></div>
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:6px;">Devices Online</div>
        </td>
      </tr>
    </table>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:20px 12px;">
    <div style="background:#0f172a;border-radius:10px 10px 0 0;padding:24px;">
      <div style="color:#ffffff;font-size:20px;font-weight:600;">📊 LINE Fleet Daily Report</div>
      <div style="color:#94a3b8;font-size:13px;margin-top:4px;">${esc(d.dateLabel)} · generated ${esc(d.generatedAt)} (Bangkok)</div>
    </div>
    ${summary}
    ${quotaSection}
    ${timelineSection}
    ${orgSections}
    <div style="text-align:center;padding:18px 12px 8px 12px;">
      <div style="font-size:11px;color:#9ca3af;">LINE Fleet Monitor</div>
    </div>
  </div>
</body>
</html>`
}

export async function sendDailyReport() {
  console.log('[daily-report] Generating report...')

  if (ALERT_EMAIL_TO.length === 0) {
    console.log('[daily-report] No recipients configured, skipping')
    return
  }

  const data = await collectReportData()
  const { start } = yesterdayRange()
  void start

  if (!data.hasData) {
    console.log('[daily-report] No data to report')
    return
  }

  const subject = `[LINE Fleet] Daily Report — ${data.dateLabel}`
  const text = buildTextReport(data)
  const html = buildHtmlReport(data)
  await sendAlertEmail(ALERT_EMAIL_TO, subject, text, html)
  console.log('[daily-report] Report sent')
}

export { buildHtmlReport, collectReportData, yesterdayRange }