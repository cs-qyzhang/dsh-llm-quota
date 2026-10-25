/**
 * Vercel AI Gateway credits (pay-as-you-go). The API key is scoped to a team,
 * so the credits endpoint reports that team's remaining balance and lifetime
 * spend directly; both figures are in USD.
 */

import { fetchJson, nowIso, resolveKey, unavailable, walletBalance } from './shared.js'

export const kind = 'vercel-gateway'
export const hosts = {
  'ai-gateway.vercel.sh': 'https://ai-gateway.vercel.sh/v1/credits',
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const json = await fetchJson(route.endpoint, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  const amount = walletBalance(json?.balance)
  if (amount === undefined) throw new Error('invalid quota response')
  const totalUsage = walletBalance(json?.total_used)

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    currency: 'USD',
    amount,
    updatedAt: nowIso(),
  }
  if (totalUsage !== undefined) result.totalUsage = totalUsage
  return result
}
