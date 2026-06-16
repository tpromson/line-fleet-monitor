export type CronJob = 'collection' | 'offline-check' | 'daily-report'

export interface CronStatus {
  running: boolean
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastErrorAt: string | null
  consecutiveFailures: number
}

type InternalState = CronStatus & { _dirty?: boolean }

const states = new Map<CronJob, InternalState>([
  ['collection', { running: false, lastStartedAt: null, lastFinishedAt: null, lastErrorAt: null, consecutiveFailures: 0 }],
  ['offline-check', { running: false, lastStartedAt: null, lastFinishedAt: null, lastErrorAt: null, consecutiveFailures: 0 }],
  ['daily-report', { running: false, lastStartedAt: null, lastFinishedAt: null, lastErrorAt: null, consecutiveFailures: 0 }],
])

const ALERT_AFTER_FAILURES = 3

export function markStart(job: CronJob): void {
  const s = states.get(job)!
  s.running = true
  s.lastStartedAt = new Date().toISOString()
}

export function markSuccess(job: CronJob): void {
  const s = states.get(job)!
  s.running = false
  s.lastFinishedAt = new Date().toISOString()
  s.consecutiveFailures = 0
}

export function markFailure(job: CronJob): void {
  const s = states.get(job)!
  s.running = false
  s.lastFinishedAt = new Date().toISOString()
  s.lastErrorAt = s.lastFinishedAt
  s.consecutiveFailures += 1
}

export function getCronStatuses(): Record<CronJob, CronStatus> {
  return {
    collection: snapshot('collection'),
    'offline-check': snapshot('offline-check'),
    'daily-report': snapshot('daily-report'),
  }
}

function snapshot(job: CronJob): CronStatus {
  const s = states.get(job)!
  return {
    running: s.running,
    lastStartedAt: s.lastStartedAt,
    lastFinishedAt: s.lastFinishedAt,
    lastErrorAt: s.lastErrorAt,
    consecutiveFailures: s.consecutiveFailures,
  }
}

export function isCronHealthy(): boolean {
  return [...states.values()].every((s) => s.consecutiveFailures < ALERT_AFTER_FAILURES)
}
