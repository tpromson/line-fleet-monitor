import { supabase } from './lib/supabase.js'
import { testChannelWebhook, sleep } from './lib/line-api.js'

const BATCH_SIZE = parseInt(process.env.WEBHOOK_BATCH_SIZE || '3', 10)
const BATCH_DELAY_MS = parseInt(process.env.WEBHOOK_BATCH_DELAY_MS || '300', 10)

export async function checkAllWebhooks() {
  console.log('[webhook] Checking webhook statuses...')

  const { data: channels, error } = await supabase
    .from('channels')
    .select('id, channel_name, access_token')
    .eq('active', true)

  if (error) {
    console.error('[webhook] Failed to fetch channels:', error.message)
    return
  }
  if (!channels || channels.length === 0) {
    console.log('[webhook] No active channels')
    return
  }

  console.log(`[webhook] Found ${channels.length} active channels (batch size: ${BATCH_SIZE})`)

  const now = new Date().toISOString()
  let successCount = 0
  let errorCount = 0

  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (channel) => {
        try {
          const status = await testChannelWebhook(channel.access_token)
          return { id: channel.id, name: channel.channel_name, status }
        } catch {
          return { id: channel.id, name: channel.channel_name, status: 'unknown' as const }
        }
      })
    )

    const updates = results.map((r) => {
      if (r.status === 'fulfilled') {
        successCount++
        return { id: r.value.id, status: r.value.status }
      }
      errorCount++
      return null
    }).filter((u): u is { id: string; status: 'online' | 'offline' | 'unknown' } => u !== null)

    if (updates.length > 0) {
      const { error: updateErr } = await supabase
        .from('channels')
        .upsert(updates.map((u) => ({ id: u.id, webhook_status: u.status, webhook_checked_at: now })))

      if (updateErr) {
        console.error('[webhook] Bulk update failed:', updateErr.message)
        for (const u of updates) {
          await supabase
            .from('channels')
            .update({ webhook_status: u.status, webhook_checked_at: now })
            .eq('id', u.id)
        }
      } else {
        for (const u of updates) {
          console.log(`[webhook] ${u.id.slice(0, 8)}: ${u.status}`)
        }
      }
    }

    if (i + BATCH_SIZE < channels.length) await sleep(BATCH_DELAY_MS)
  }

  console.log(`[webhook] Check complete (${successCount} ok, ${errorCount} errors)`)
}
