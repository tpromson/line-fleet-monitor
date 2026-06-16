# AGENTS.md

Instructions for AI agents working on this codebase.

## Stack

- **Frontend**: React 19 + Vite 8, shadcn/ui + Tailwind CSS 4, React Router 7
- **Backend**: Express + TypeScript (tsx runner), cron jobs (node-cron)
- **Database**: Supabase (PostgreSQL) with RLS + column-level privileges
- **Auth**: Supabase Auth (JWT via `@supabase/supabase-js`)
- **Email**: Resend (alerts)
- **Testing**: Vitest (both apps)
- **Hosting**: Frontend on Vercel, backend on Railway (port 3001)

## Architecture

```
apps/
  backend/   – Express API server + cron scheduler
  web/       – React SPA (Vite)
supabase/
  migrations/ – SQL migration files
docs/
  adr/       – Architecture Decision Records
```

The frontend talks to Supabase directly (RLS enforces authorization). The backend exists only for:
1. **Scheduled cron jobs**: Quota collection, alert checks, webhook health checks
2. **Protected API endpoints**: manual sync trigger, webhook test, user lookup (requires auth)

## Commands

```bash
# Install
npm install

# Dev
npm run dev:web         # Vite dev server (port 5173)
npm run dev:backend     # Express + cron (port 3001)

# Tests
npm run test -w apps/backend    # 20 tests
npm run test -w apps/web        # 11 tests

# Build
npm run build:web       # tsc + vite build
npm run build:backend   # tsc

# Type-check only
npx tsc --noEmit -w apps/backend
npm run lint -w apps/web
```

## Environment Variables

### Backend (`apps/backend/.env`)
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
ALERT_EMAIL_FROM=
ALERT_EMAIL_TO=
PORT=3001
CORS_ORIGIN=https://line-fleet-monitor-web.vercel.app
# CORS_ORIGIN supports multiple origins (comma-separated), e.g. for local dev + prod:
# CORS_ORIGIN=https://line-fleet-monitor-web.vercel.app,http://localhost:5173
# Backend URL: https://line-fleetbackend-production.up.railway.app

# iotcenter outlier filter (default: filter 25°C on first reading after a 20s gap)
OUTLIER_RECONNECT_GAP_MS=20000
OUTLIER_RECONNECT_TEMP=25
```

### Frontend (`apps/web/.env`)
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_BACKEND_URL=https://line-fleetbackend-production.up.railway.app
```

## Database

Supabase with RLS enforced across all tables. Migration files in `supabase/migrations/`. Apply with:
```bash
npx supabase db push
```

Key design decisions (see ADRs):
- **ADR 0001**: Frontend talks to Supabase directly (no REST wrapper). Backend only for cron + protected ops.
- **ADR 0002**: `channel_secret` and `access_token` columns are revoked from `authenticated`/`anon` roles. Only `service_role` (backend) can read them.

## Domain Language

Use these terms consistently (from `CONTEXT.md`):

| Term | Meaning | Avoid |
|---|---|---|
| Organization | Group of users owning Providers/Channels | Tenant, Company, Team |
| Provider | Grouping unit for Channels (maps to LINE Provider) | Service, Project |
| Channel | LINE Messaging API Channel (= LINE OA) | OA, Bot, Account |
| Quota | Push message allowance per Channel/month (limit + usage) | Allowance, Capacity |
| Alert | Notification when Quota crosses threshold | Notification, Alarm |
| Forecast | Predicted exhaustion date | Prediction, Estimation |
| Webhook Status | Channel webhook health: online/offline/unknown | Connection Status, Health |

## Alert Levels

| Level | Threshold | Behavior |
|---|---|---|
| `recovery` | Usage < 80% | Only sent if prior alert existed |
| `warning` | Usage >= 80% | First crossing triggers alert |
| `critical` | Usage >= 95% | First crossing triggers alert |

Alerts fire only once per level crossing — no repeat while still at same level.

## Backend Auth Middleware

All protected endpoints require a Supabase JWT in the `Authorization: Bearer <token>` header.

- `requireAuth()` — any authenticated user (returns `AuthContext`)
- `requireSuperAdmin()` — user with `app_metadata.role === 'super_admin'`
- `getAuthorizedChannelAccessToken(channelId, auth)` — resolves access token via org membership (or super admin bypass)

## Frontend API Helper

```ts
import { fetchBackend } from '@/lib/backend-api'
// Automatically attaches Bearer token from Supabase session
await fetchBackend('/api/sync', { method: 'POST' })
```

## Code Conventions

- TypeScript strict mode on both apps
- `type: "module"` (ESM imports)
- Test files: `src/__tests__/*.test.ts` (backend excluded from `tsc` build)
- No comments unless absolutely necessary
- Backend lib modules prefixed: `src/lib/` (supabase.ts, line-api.ts, auth.ts, email.ts)
- Frontend lib modules: `src/lib/` (supabase.ts, backend-api.ts, utils.ts)
