/**
 * Absolute sanity bounds for any temperature reading across all sources.
 * Anything outside this range is a sensor glitch (e.g. DHT22 read error,
 * reconnect spike), not a real cold-chain reading — no monitored fridge,
 * freezer, or storage room legitimately goes below -40°C or above 60°C.
 *
 * This mirrors (but is intentionally wider than) the per-source
 * MAX_PLAUSIBLE_TEMP/MIN_PLAUSIBLE_TEMP checks baked into individual GAS
 * scripts, and is separate from the backend's narrow ~25°C reconnect-glitch
 * filter (apps/backend/src/routes/iotcenter.ts isReconnectOutlierTemp).
 *
 * IMPORTANT: the main dashboard (/iotcenter) and source-detail pages query
 * Supabase directly and never go through the backend, so backend-side
 * outlier filtering does not protect them — this check must be applied
 * client-side wherever a raw event payload's temperature is read.
 */
export const MIN_PLAUSIBLE_TEMP = -40
export const MAX_PLAUSIBLE_TEMP = 60

export function isPlausibleTemp(t: unknown): t is number {
  return typeof t === 'number' && !Number.isNaN(t) && t >= MIN_PLAUSIBLE_TEMP && t <= MAX_PLAUSIBLE_TEMP
}
