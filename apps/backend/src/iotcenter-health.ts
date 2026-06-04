import { supabase } from './lib/supabase.js'

const DEFAULT_OFFLINE_MINUTES = 35

export async function detectOfflineDevices() {
  console.log('[iotcenter] Checking for offline devices...')

  const { data: sources } = await supabase
    .from('sources')
    .select('id, metadata')
    .eq('active', true)

  if (!sources || sources.length === 0) return

  const sourceIds = sources.map((s) => s.id)
  const sourceThresholds = new Map<string, number>()
  for (const s of sources) {
    const metadata = s.metadata as Record<string, unknown> | null
    sourceThresholds.set(s.id, (metadata?.offline_threshold_minutes as number) || DEFAULT_OFFLINE_MINUTES)
  }

  const cutoffBySource: Record<string, string> = {}
  for (const [id, threshold] of sourceThresholds) {
    cutoffBySource[id] = new Date(Date.now() - threshold * 60 * 1000).toISOString()
  }

  const staleIds: string[] = []
  const staleEvents: Array<Record<string, unknown>> = []

  for (const [sourceId, cutoff] of Object.entries(cutoffBySource)) {
    const { data: staleDevices } = await supabase
      .from('devices')
      .select('id, device_name, source_id')
      .eq('source_id', sourceId)
      .eq('status', 'online')
      .lt('last_seen', cutoff)

    if (!staleDevices || staleDevices.length === 0) continue

    for (const d of staleDevices) {
      staleIds.push(d.id)
      staleEvents.push({
        source_id: sourceId,
        device_id: d.id,
        event_type: 'device_offline',
        level: 'critical',
        message: `Device ${d.device_name} went offline (no heartbeat for >${sourceThresholds.get(sourceId)} min)`,
      })
    }
  }

  if (staleIds.length > 0) {
    await supabase
      .from('devices')
      .update({ status: 'offline', updated_at: new Date().toISOString() })
      .in('id', staleIds)

    await supabase.from('events').insert(staleEvents)
    console.log(`[iotcenter] Marked ${staleIds.length} devices offline`)
  }

  const halfCutoff = new Date(Date.now() - Math.floor(DEFAULT_OFFLINE_MINUTES / 2) * 60 * 1000).toISOString()
  const fullCutoff = new Date(Date.now() - DEFAULT_OFFLINE_MINUTES * 60 * 1000).toISOString()

  const { data: delayedDevices } = await supabase
    .from('devices')
    .select('id')
    .eq('status', 'online')
    .lt('last_seen', halfCutoff)
    .gte('last_seen', fullCutoff)

  if (delayedDevices && delayedDevices.length > 0) {
    const delayedIds = delayedDevices.map((d) => d.id)
    await supabase
      .from('devices')
      .update({ status: 'delayed', updated_at: new Date().toISOString() })
      .in('id', delayedIds)
    console.log(`[iotcenter] Marked ${delayedIds.length} devices delayed`)
  }

  console.log('[iotcenter] Offline detection complete')
}