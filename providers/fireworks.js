/**
 * Fireworks AI month-to-date rated spend (pay-as-you-go).
 *
 * Fireworks has no credit-balance endpoint, so the plugin shows the current
 * UTC month's rated cost from the billing summary. The API key is not bound to
 * an account id, so the accessible accounts are discovered first and their
 * costs are aggregated.
 */

import { currentUtcMonth, decimalAmount, fetchJson, nowIso, resolveKey, unavailable } from './shared.js'

export const kind = 'fireworks'
export const hosts = {
  'api.fireworks.ai': 'https://api.fireworks.ai/v1',
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  const base = route.endpoint ?? hosts['api.fireworks.ai']
  const accounts = await fetchJson(`${base}/accounts`, { headers })
  const names = Array.isArray(accounts?.accounts)
    ? accounts.accounts
      .map((account) => account?.name)
      .filter((name) => typeof name === 'string' && name.length > 0)
    : []
  if (names.length === 0) throw new Error('no accessible Fireworks account')

  const { startIso, endIso } = currentUtcMonth()
  const query = `startTime=${encodeURIComponent(startIso)}&endTime=${encodeURIComponent(endIso)}`
  const summaries = await Promise.all(names.map((name) => (
    fetchJson(`${base}/accounts/${accountIdOf(name)}/billing/summary?${query}`, { headers })
  )))

  let total = 0
  let currency = 'USD'
  for (const summary of summaries) {
    if (!Array.isArray(summary?.lineItems)) throw new Error('invalid quota response')
    for (const item of summary.lineItems) {
      const amount = moneyOf(item?.totalCost)
      if (amount === undefined) throw new Error('invalid quota response')
      total += amount
      if (typeof item?.totalCost?.currencyCode === 'string' && item.totalCost.currencyCode) {
        currency = item.totalCost.currencyCode
      }
    }
  }

  return {
    ok: true,
    provider: route.provider,
    kind,
    currency,
    usedAmount: decimalAmount(total),
    updatedAt: nowIso(),
  }
}

/** Resource names look like `accounts/my-account`; the path wants the id. */
function accountIdOf(name) {
  return name.slice(name.lastIndexOf('/') + 1)
}

/** typeMoney: whole currency units plus nanos (10^-9 units). */
function moneyOf(value) {
  const units = Number(value?.units ?? 0)
  const nanos = Number(value?.nanos ?? 0)
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return undefined
  return units + nanos / 1e9
}
