# Scripts

Manual debug/ops scripts. Excluded from the production build (`tsconfig.json`
only includes `src/`). Run via the npm scripts so env vars are loaded from
`.env` automatically.

| Command | Script | Purpose |
|---|---|---|
| `npm run report:preview` | `preview-daily-report.ts` | Render yesterday's daily report to an HTML file (default `/tmp/daily-report-preview.html`). Does **not** send email. Pass an output path as the first arg. |
| `npm run report:test` | `test-daily-report.ts` | Run the full `sendDailyReport()` pipeline against live data and **send a real email** to `ALERT_EMAIL_TO`. Use to verify the report end-to-end before a scheduled run. |
| `npm run report:debug-email` | `test-resend-debug.ts` | Send a minimal test email through Resend. Use to isolate whether a delivery problem is the report content or Resend connectivity. |

All scripts require the backend `.env` (`SUPABASE_*`, `RESEND_API_KEY`,
`ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`).
