/**
 * OpenRouter credits (pay-as-you-go). The credits endpoint reports how much has
 * been purchased and consumed, so the remaining balance is the difference.
 */

import { fetchJson, nowIso, resolveKey, unavailable } from './shared.js'

export const kind = 'openrouter'
export const hosts = {
  'openrouter.ai': 'https://openrouter.ai/api/v1/credits',
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const json = await fetchJson(route.endpoint, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const totalCredits = numberOf(json?.data?.total_credits)
  if (totalCredits === undefined) throw new Error('invalid quota response')
  const totalUsage = numberOf(json?.data?.total_usage) ?? 0

  return {
    ok: true,
    provider: route.provider,
    kind,
    currency: 'USD',
    amount: decimal(Math.max(0, totalCredits - totalUsage)),
    totalCredits: decimal(totalCredits),
    totalUsage: decimal(totalUsage),
    updatedAt: nowIso(),
  }
}

function numberOf(value) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

/** Keep the computed difference from surfacing floating-point tails. */
function decimal(value) {
  return String(Number(value.toFixed(6)))
}
