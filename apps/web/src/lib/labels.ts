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

export function humanLabel(key: string): string {
  return LABEL_MAP[key] ?? key
}

export function formatPayloadValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return Number(value).toFixed(1)
  return String(value)
}

export function payloadEntryLabel(key: string, value: unknown): string {
  return `${humanLabel(key)}: ${formatPayloadValue(value)}`
}
