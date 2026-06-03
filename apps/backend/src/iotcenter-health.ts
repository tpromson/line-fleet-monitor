import { supabase } from './lib/supabase.js'

const DEFAULT_OFFLINE_MINUTES = 35

export async function detectOfflineDevices() {
  console.log('[iotcenter] Checking for offline devices...')

  const { data: sources } = await supabase
    .from('sources')
    .select('id, metadata')
    .eq('active', true)

  if (!sources || sources.length === 0) return

  for (const source of sources) {
    const metadata = source.metadata as Record<string, unknown> | null
    const offlineThreshold = (metadata?.offline_threshold_minutes as number) || DEFAULT_OFFLINE_MINUTES

    const cutoff = new Date(Date.now() - offlineThreshold * 60 * 1000).toISOString()

    const { data: staleDevices } = await supabase
      .from('devices')
      .select('id, device_name')
      .eq('source_id', source.id)
      .eq('status', 'online')
      .lt('last_seen', cutoff)

    if (!staleDevices || staleDevices.length === 0) continue

    for (const device of staleDevices) {
      await supabase
        .from('devices')
        .update({ status: 'offline', updated_at: new Date().toISOString() })
        .eq('id', device.id)

      await supabase.from('events').insert({
        source_id: source.id,
        device_id: device.id,
        event_type: 'device_offline',
        level: 'critical',
        message: `Device ${device.device_name} went offline (no heartbeat for >${offlineThreshold} min)`,
      })

      console.log(`[iotcenter] Device ${device.device_name} marked offline`)
    }
  }

  const { data: delayedDevices } = await supabase
    .from('devices')
    .select('id, device_name, last_seen')
    .eq('status', 'online')
    .lt('last_seen', new Date(Date.now() - Math.floor(DEFAULT_OFFLINE_MINUTES / 2) * 60 * 1000).toISOString())
    .gte('last_seen', new Date(Date.now() - DEFAULT_OFFLINE_MINUTES * 60 * 1000).toISOString())

  if (delayedDevices && delayedDevices.length > 0) {
    for (const device of delayedDevices) {
      await supabase
        .from('devices')
        .update({ status: 'delayed', updated_at: new Date().toISOString() })
        .eq('id', device.id)

      console.log(`[iotcenter] Device ${device.device_name} marked delayed`)
    }
  }

  console.log('[iotcenter] Offline detection complete')
}
