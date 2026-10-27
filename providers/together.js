/**
 * Together AI month-to-date billing usage (pay-as-you-go).
 *
 * Together retired the credit-balance endpoint; the billing usage API reports
 * per-period cost line items, so the plugin shows the current month's rated
 * cost in USD. The API is beta and enabled per organization, so accounts that
 * never opted in see a temporary failure.
 */

import { currentUtcMonth, decimalAmount, fetchJson, nowIso, resolveKey, unavailable } from './shared.js'

export const kind = 'together'
export const hosts = {
  'api.together.ai': 'https://api.together.ai/v1/billing/usage',
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const { month } = currentUtcMonth()
  const json = await fetchJson(`${route.endpoint}?month=${encodeURIComponent(month)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!Array.isArray(json?.data)) throw new Error('invalid quota response')

  let total = 0
  for (const bucket of json.data) {
    const items = Array.isArray(bucket?.line_items) ? bucket.line_items : []
    for (const item of items) {
      const cost = Number(item?.cost ?? 0)
      if (!Number.isFinite(cost)) throw new Error('invalid quota response')
      total += cost
    }
  }

  return {
    ok: true,
    provider: route.provider,
    kind,
    currency: typeof json?.currency === 'string' && json.currency ? json.currency : 'USD',
    usedAmount: decimalAmount(total),
    updatedAt: nowIso(),
  }
}
