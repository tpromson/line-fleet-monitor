import { supabase } from './lib/supabase.js'
import { sendAlertEmail } from './lib/email.js'

interface ChannelAlertState {
  channel_id: string
  channel_name: string
  quota_used: number
  quota_limit: number
  usage_pct: number
  last_alert_level: string | null
}

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO?.split(',').map((e) => e.trim()) ?? []

export async function checkAlerts() {
  console.log('[alert] Checking thresholds...')

  const { data: channels } = await supabase
    .from('channels')
    .select('id, channel_name, quota_limit')
    .eq('active', true)

  if (!channels) return

  for (const channel of channels) {
    const { data: latestLog } = await supabase
      .from('quota_logs')
      .select('quota_used')
      .eq('channel_id', channel.id)
      .is('error', null)
      .order('checked_at', { ascending: false })
      .limit(1)
      .single()

    if (!latestLog) continue

    const usagePct = (latestLog.quota_used / channel.quota_limit) * 100

    const { data: lastAlert } = await supabase
      .from('alerts')
      .select('level')
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const newLevel = determineLevel(usagePct)
    const lastLevel = lastAlert?.level ?? null

    if (newLevel === lastLevel) continue
    if (lastLevel === null && newLevel === 'normal') continue

    const message = buildMessage(channel.channel_name, latestLog.quota_used, channel.quota_limit, newLevel)

    await supabase.from('alerts').insert({
      channel_id: channel.id,
      level: newLevel,
      message,
    })

    await sendAlertEmail(ALERT_EMAIL_TO, `[LINE Fleet] ${newLevel.toUpperCase()}: ${channel.channel_name}`, message)

    console.log(`[alert] ${channel.channel_name}: ${newLevel} (${usagePct.toFixed(1)}%)`)
  }

  console.log('[alert] Check complete')
}

function determineLevel(usagePct: number): 'normal' | 'warning' | 'critical' {
  if (usagePct >= 95) return 'critical'
  if (usagePct >= 80) return 'warning'
  return 'normal'
}

function buildMessage(name: string, used: number, limit: number, level: string): string {
  const remaining = limit - used
  if (level === 'normal') {
    return `✅ ${name} — Quota back to normal (${used}/${limit}, ${remaining} remaining)`
  }
  const emoji = level === 'critical' ? '🔴' : '⚠️'
  return `${emoji} LINE Quota ${level.toUpperCase()}\n\nChannel: ${name}\nUsed: ${used}/${limit}\nRemaining: ${remaining}\nUsage: ${((used / limit) * 100).toFixed(1)}%`
}
