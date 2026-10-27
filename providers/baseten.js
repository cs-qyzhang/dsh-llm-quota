/**
 * Baseten month-to-date billing usage (pay-as-you-go).
 *
 * Baseten has no credit-balance endpoint; the management billing summary
 * reports costs for a date range, so the plugin shows the current UTC month's
 * rated cost in USD together with its credit split.
 */

import { currentUtcMonth, decimalAmount, fetchJson, nowIso, resolveKey, unavailable } from './shared.js'

export const kind = 'baseten'
export const hosts = {
  'inference.baseten.co': 'https://api.baseten.co/v1/billing/usage_summary',
}

const SECTIONS = ['dedicated_usage', 'training_usage', 'model_apis_usage']

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const { startIso, endIso } = currentUtcMonth()
  const query = `start_date=${encodeURIComponent(startIso)}&end_date=${encodeURIComponent(endIso)}`
  const json = await fetchJson(`${route.endpoint}?${query}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  const usage = json && typeof json === 'object' ? json : {}
  if (!SECTIONS.some((name) => name in usage)) throw new Error('invalid quota response')

  // A section present but null means "no usage of this kind", not a bad payload.
  const sections = SECTIONS.map((name) => usage[name]).filter((section) => section && typeof section === 'object')

  return {
    ok: true,
    provider: route.provider,
    kind,
    currency: 'USD',
    usedAmount: decimalAmount(sumOf(sections, 'total')),
    creditsAmount: decimalAmount(sumOf(sections, 'credits_used')),
    chargedAmount: decimalAmount(sumOf(sections, 'subtotal')),
    updatedAt: nowIso(),
  }
}

function sumOf(sections, field) {
  let total = 0
  for (const section of sections) {
    const value = Number(section[field] ?? 0)
    if (!Number.isFinite(value)) throw new Error('invalid quota response')
    total += value
  }
  return total
}
