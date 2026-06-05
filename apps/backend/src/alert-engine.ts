import { supabase } from './lib/supabase.js'
import { sendAlertEmail } from './lib/email.js'

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.split(',').map((e) => e.trim()).filter(Boolean) ?? []

export async function checkAlerts() {
  console.log('[alert] Checking thresholds...')

  const { data: channels } = await supabase
    .from('channels')
    .select('id, channel_name, quota_limit')
    .eq('active', true)

  if (!channels || channels.length === 0) return

  const channelIds = channels.map((c) => c.id)

  const { data: latestLogs } = await supabase
    .from('quota_logs')
    .select('channel_id, quota_used')
    .in('channel_id', channelIds)
    .is('error', null)
    .order('checked_at', { ascending: false })
    .limit(channelIds.length * 4)

  const latestByChannel = new Map<string, number>()
  if (latestLogs) {
    for (const log of latestLogs) {
      if (!latestByChannel.has(log.channel_id)) {
        latestByChannel.set(log.channel_id, log.quota_used)
      }
    }
  }

  const { data: lastAlerts } = await supabase
    .from('alerts')
    .select('channel_id, level')
    .in('channel_id', channelIds)
    .order('created_at', { ascending: false })

  const alertByChannel = new Map<string, string>()
  if (lastAlerts) {
    for (const a of lastAlerts) {
      if (!alertByChannel.has(a.channel_id)) {
        alertByChannel.set(a.channel_id, a.level)
      }
    }
  }

  const alertsToInsert: Array<Record<string, unknown>> = []
  const emailItems: Array<{ name: string; level: string; message: string }> = []

  for (const channel of channels) {
    const quotaUsed = latestByChannel.get(channel.id)
    if (quotaUsed === undefined) continue

    const usagePct = (quotaUsed / channel.quota_limit) * 100
    const newLevel = determineLevel(usagePct)
    const lastLevel = alertByChannel.get(channel.id) ?? null

    if (newLevel === lastLevel) continue
    if (lastLevel === null && newLevel === 'recovery') continue

    const message = buildMessage(channel.channel_name, quotaUsed, channel.quota_limit, newLevel)

    alertsToInsert.push({
      channel_id: channel.id,
      level: newLevel,
      message,
    })

    emailItems.push({ name: channel.channel_name, level: newLevel, message })
    console.log(`[alert] ${channel.channel_name}: ${newLevel} (${usagePct.toFixed(1)}%)`)
  }

  if (alertsToInsert.length > 0) {
    await supabase.from('alerts').insert(alertsToInsert)
  }

  if (emailItems.length > 0) {
    const subject = emailItems.length === 1
      ? `[LINE Fleet] ${emailItems[0].level.toUpperCase()}: ${emailItems[0].name}`
      : `[LINE Fleet] ${emailItems.length} alerts (${emailItems.filter((i) => i.level === 'critical').length} critical)`
    const body = emailItems.length === 1
      ? emailItems[0].message
      : emailItems.map((i) => i.message).join('\n\n---\n\n')
    await sendAlertEmail(ALERT_EMAIL_TO, subject, body)
  }

  console.log('[alert] Check complete')
}

function determineLevel(usagePct: number): 'recovery' | 'warning' | 'critical' {
  if (usagePct >= 95) return 'critical'
  if (usagePct >= 80) return 'warning'
  return 'recovery'
}

function buildMessage(name: string, used: number, limit: number, level: string): string {
  const remaining = limit - used
  if (level === 'recovery') {
    return `✅ ${name} — Quota back to normal (${used}/${limit}, ${remaining} remaining)`
  }
  const emoji = level === 'critical' ? '🔴' : '⚠️'
  return `${emoji} LINE Quota ${level.toUpperCase()}\n\nChannel: ${name}\nUsed: ${used}/${limit}\nRemaining: ${remaining}\nUsage: ${((used / limit) * 100).toFixed(1)}%`
}
