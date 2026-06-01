import { supabase } from './lib/supabase.js'
import { fetchChannelQuota, sleep } from './lib/line-api.js'

export async function collectAllQuotas() {
  console.log('[collector] Starting quota collection...')

  const { data: channels, error } = await supabase
    .from('channels')
    .select('id, channel_name, access_token, quota_limit')
    .eq('active', true)

  if (error || !channels) {
    console.error('[collector] Failed to fetch channels:', error?.message)
    return
  }

  console.log(`[collector] Found ${channels.length} active channels`)

  for (const channel of channels) {
    try {
      const quota = await fetchChannelQuota(channel.access_token, channel.quota_limit)

      await supabase.from('quota_logs').insert({
        channel_id: channel.id,
        quota_limit: quota.limit,
        quota_used: quota.used,
        quota_remaining: quota.remaining,
        error: quota.error ?? null,
      })

      if (quota.error) {
        console.warn(`[collector] ${channel.channel_name}: ${quota.error}`)
      } else {
        console.log(`[collector] ${channel.channel_name}: ${quota.used}/${quota.limit}`)
      }
    } catch (err) {
      console.error(`[collector] ${channel.channel_name}: unexpected error`, err)
    }

    await sleep(500)
  }

  console.log('[collector] Collection complete')
}
