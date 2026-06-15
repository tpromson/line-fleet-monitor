import { writeFileSync } from 'node:fs'
import { buildHtmlReport, collectReportData, yesterdayRange } from '../src/daily-report.js'
import { validateEnv } from '../src/lib/env.js'

validateEnv()

const { start, end } = yesterdayRange()
console.log(`[preview] Range: ${start.toISOString()} – ${end.toISOString()}`)

const data = await collectReportData()
console.log(`[preview] Channels: ${data.channels.length} · Orgs: ${data.orgs.length}`)

const html = buildHtmlReport(data)
const out = process.argv[2] ?? '/tmp/daily-report-preview.html'
writeFileSync(out, html, 'utf-8')
console.log(`[preview] Wrote ${out} (${html.length} bytes)`)
