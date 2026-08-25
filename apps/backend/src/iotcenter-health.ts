import { supabase } from './lib/supabase.js'
import { sendMophNotify } from './lib/moph-notify.js'

const DEFAULT_OFFLINE_MINUTES = 35

function formatBangkokDate(date: Date): string {
  return date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function detectOfflineDevices() {
  console.log('[iotcenter] Checking for offline devices...')

  const { data: sources } = await supabase
    .from('sources')
    .select('id, metadata, organization_id')
    .eq('active', true)

  if (!sources || sources.length === 0) return

  const sourceIds = sources.map((s) => s.id)
  const sourceThresholds = new Map<string, number>()
  const sourceOrganizations = new Map<string, string>()
  for (const s of sources) {
    const metadata = s.metadata as Record<string, unknown> | null
    sourceThresholds.set(s.id, (metadata?.offline_threshold_minutes as number) || DEFAULT_OFFLINE_MINUTES)
    sourceOrganizations.set(s.id, s.organization_id)
  }

  const cutoffBySource: Record<string, string> = {}
  for (const [id, threshold] of sourceThresholds) {
    cutoffBySource[id] = new Date(Date.now() - threshold * 60 * 1000).toISOString()
  }

  const staleIds: string[] = []
  const staleEvents: Array<Record<string, unknown>> = []
  const staleDevicesForMessage: Array<{
    id: string
    device_name: string
    source_id: string
    last_seen: string | null
    organization_id: string
  }> = []

  for (const [sourceId, cutoff] of Object.entries(cutoffBySource)) {
    const { data: staleDevices } = await supabase
      .from('devices')
      .select('id, device_name, source_id, last_seen')
      .eq('source_id', sourceId)
      .eq('status', 'online')
      .lt('last_seen', cutoff)

    if (!staleDevices || staleDevices.length === 0) continue

    for (const d of staleDevices) {
      staleDevicesForMessage.push({ ...d, organization_id: sourceOrganizations.get(d.source_id) || '' })
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

    const targetOrganizationId = process.env.MOPH_NOTIFY_ORGANIZATION_ID?.trim()
    const notifyDevices = targetOrganizationId
      ? staleDevicesForMessage.filter((device) => device.organization_id === targetOrganizationId)
      : staleDevicesForMessage

    if (notifyDevices.length > 0) {
      const message = [
      '🚨 แจ้งเตือน Sensor Offline',
      `ตรวจพบเมื่อ: ${formatBangkokDate(new Date())}`,
      `จำนวน: ${notifyDevices.length} อุปกรณ์`,
      '',
      notifyDevices.map((device) => {
        const threshold = sourceThresholds.get(device.source_id) || DEFAULT_OFFLINE_MINUTES
        const lastSeen = device?.last_seen
          ? formatBangkokDate(new Date(device.last_seen))
          : 'ไม่ทราบเวลา'
        return [
          `📍 ${device?.device_name || 'ไม่ระบุอุปกรณ์'}`,
          `└ ไม่ได้รับข้อมูลเกิน ${threshold} นาที`,
          `└ ล่าสุด: ${lastSeen}`,
        ].join('\n')
      }).join('\n\n'),
      ].join('\n')

      const notifyResult = await sendMophNotify(message, targetOrganizationId)
      if (notifyResult.status === 'failed') {
        console.error('[iotcenter] Offline MOPH Notify failed:', notifyResult.reason)
      }
    }
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
