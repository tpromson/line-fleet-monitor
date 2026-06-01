import { supabase } from './lib/supabase.js'
import { testChannelWebhook, sleep } from './lib/line-api.js'

export async function checkAllWebhooks() {
  console.log('[webhook] Checking webhook statuses...')

  const { data: channels } = await supabase
    .from('channels')
    .select('id, channel_name, access_token')
    .eq('active', true)

  if (!channels) return

  for (const channel of channels) {
    try {
      const status = await testChannelWebhook(channel.access_token)
      await supabase
        .from('channels')
        .update({
          webhook_status: status,
          webhook_checked_at: new Date().toISOString(),
        })
        .eq('id', channel.id)
      console.log(`[webhook] ${channel.channel_name}: ${status}`)
    } catch (err) {
      await supabase
        .from('channels')
        .update({
          webhook_status: 'unknown',
          webhook_checked_at: new Date().toISOString(),
        })
        .eq('id', channel.id)
      console.warn(`[webhook] ${channel.channel_name}: error`, err)
    }

    await sleep(500)
  }

  console.log('[webhook] Check complete')
}
