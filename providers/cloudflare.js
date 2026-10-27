/**
 * Cloudflare Workers AI / AI Gateway prepaid balance and month-to-date spend.
 *
 * Quota reads the AI Gateway billing API with an account-level API Token that
 * carries the AI Gateway Read and Billing Read permissions plus the account id
 * — this token is NOT the Workers AI / AI Gateway inference token configured
 * for model calls, which cannot read billing. Amounts are USD: `amount` is the
 * remaining prepaid credit and `cycleUsage` is the current UTC month's rated
 * spend from the daily usage history.
 */

import { currentUtcMonth, decimalAmount, fetchJson, nowIso, resolveKey, unavailable, walletBalance } from './shared.js'

export const kind = 'cloudflare'
export const DEFAULT_ENDPOINT = 'https://api.cloudflare.com/client/v4'
export const KEY_NAMES = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY']

// The account id is per-credential, so a static hostname -> endpoint map cannot
// express routes; the integration layer matches hosts via `routeFor` instead.
export const hosts = {}

export function routeFor(baseURL) {
  const hostname = hostnameOf(baseURL)
  if (
    hostname === 'api.cloudflare.com'
    || hostname === 'gateway.ai.cloudflare.com'
    || (hostname !== undefined && hostname.endsWith('.workers.dev'))
  ) {
    return { endpoint: DEFAULT_ENDPOINT }
  }
  return undefined
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames?.length ? route.keyNames : KEY_NAMES)
  const accountId = await resolveKey(ctx, ['CLOUDFLARE_ACCOUNT_ID'])
  if (!key || !accountId) return unavailable(route, 'missing-credential')

  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  const base = route.endpoint ?? DEFAULT_ENDPOINT
  const root = `${base}/accounts/${encodeURIComponent(accountId)}/ai-gateway/billing`

  // Transport/HTTP failures are tolerated per leg; malformed payloads throw.
  let balanceError
  let balanceResult
  const balanceResponse = await tryFetchJson(`${root}/credit-balance`, { headers })
  if (balanceResponse.error) {
    balanceError = balanceResponse.error
  } else {
    balanceResult = envelopeOf(balanceResponse.payload)
  }

  let usageError
  let cycleUsage
  const { startIso, endIso } = currentUtcMonth()
  const query = `value_grouping_window=day&start_time=${Date.parse(startIso)}&end_time=${Date.parse(endIso)}`
  const usageResponse = await tryFetchJson(`${root}/usage-history?${query}`, { headers })
  if (usageResponse.error) {
    usageError = usageResponse.error
  } else {
    const usage = envelopeOf(usageResponse.payload)
    if (!Array.isArray(usage.history)) throw new Error('invalid quota response')
    let total = 0
    for (const entry of usage.history) {
      const value = Number(entry?.aggregated_value)
      if (!Number.isFinite(value)) throw new Error('invalid quota response')
      total += value
    }
    cycleUsage = decimalAmount(total)
  }

  // Both legs failed: nothing to report, surface the balance error to the caller.
  if (balanceError && usageError) throw balanceError

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    currency: 'USD',
    updatedAt: nowIso(),
  }
  const amount = balanceError ? undefined : walletBalance(balanceResult?.balance)
  if (amount !== undefined) result.amount = amount
  if (usageError === undefined) result.cycleUsage = cycleUsage
  if (typeof balanceResult?.has_default_payment_method === 'boolean') {
    result.hasPaymentMethod = balanceResult.has_default_payment_method
  }
  return result
}

/** Return the JSON payload or the transport error instead of throwing. */
async function tryFetchJson(url, init) {
  try {
    return { payload: await fetchJson(url, init) }
  } catch (error) {
    return { error }
  }
}

/** Validate the standard Cloudflare `{ success, errors, result }` envelope. */
function envelopeOf(payload) {
  if (!payload || payload.success === false || !payload.result || typeof payload.result !== 'object') {
    throw new Error('invalid quota response')
  }
  return payload.result
}

function hostnameOf(baseURL) {
  try {
    return new URL(baseURL).hostname
  } catch {
    return undefined
  }
}
