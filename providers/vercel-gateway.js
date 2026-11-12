/**
 * Vercel AI Gateway credits (pay-as-you-go). The API key is scoped to a team,
 * so the credits endpoint reports that team's remaining balance and lifetime
 * spend directly; both figures are in USD.
 */

import { walletBalance } from './shared.js'

export const kind = 'vercel-gateway'
export const hosts = {
  'ai-gateway.vercel.sh': 'https://ai-gateway.vercel.sh/v1/credits',
}

export const view = { preset: 'credits', title: 'Vercel AI Gateway' }

export async function read({ route, credentials, http, nowIso }, _route) {
  const key = await credentials.resolve(route.keyNames)
  if (!key) return { reason: 'missing-credential' }

  const json = await http.json(route.endpoint, {
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
