const LABEL_MAP: Record<string, string> = {
  temperature: 'อุณหภูมิ',
  threshold: 'เกณฑ์',
  unit: 'หน่วย',
  maxTemp: 'สูงสุด',
  minTemp: 'ต่ำสุด',
  avgTemp: 'เฉลี่ย',
  recordsCount: 'จำนวนบันทึก',
  period: 'ช่วงเวลา',
  date: 'วันที่',
  lastTemperature: 'อุณหภูมิล่าสุด',
  lastRow: 'แถวล่าสุด',
  lastContact: 'ติดต่อล่าสุด',
  minutesSinceLastContact: 'ขาดการติดต่อ (นาที)',
  scriptName: 'สคริปต์',
  error: 'ข้อผิดพลาด',
  reportType: 'ประเภทรายงาน',
}

export const DEFAULT_TZ = 'Asia/Bangkok'

export function todayInTz(tz: string = DEFAULT_TZ): string {
  return new Date().toLocaleDateString('en-GB', { timeZone: tz })
}

export function dateStrInTz(iso: string, tz: string = DEFAULT_TZ): string {
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: tz })
}

export function humanLabel(key: string): string {
  return LABEL_MAP[key] ?? key
}

export function formatPayloadValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1)
  return String(value)
}

export function payloadEntryLabel(key: string, value: unknown): string {
  return `${humanLabel(key)}: ${formatPayloadValue(value)}`
}

export function formatTimestamp(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatTimestampShort(isoString: string): string {
  const d = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 60) return diffMin + 'm ago'
  if (diffMin < 1440) return Math.floor(diffMin / 60) + 'h ago'
  return d.toLocaleDateString()
}
