/**
 * Radius (radius.pi.dev) organization credit balance and current-period spend.
 *
 * Radius is the Pi / Earendil AI gateway. API keys are organization-scoped
 * gateway bearer credentials, so the organization bound to a key is discovered
 * through the organizations list before reading the billing summary, which
 * carries the live credit balance and the current UTC-month charges in a
 * single call. Amounts are floating-point values in the response currency.
 */

import { decimalAmount, fetchJson, nowIso, resolveKey, unavailable, walletBalance } from './shared.js'

export const kind = 'radius'
export const DEFAULT_ENDPOINT = 'https://radius.pi.dev'
export const KEY_NAMES = ['RADIUS_API_KEY']

export const hosts = {
  'radius.pi.dev': DEFAULT_ENDPOINT,
}

export async function read(ctx, route) {
  const names = Array.isArray(route.keyNames) && route.keyNames.length > 0 ? route.keyNames : KEY_NAMES
  const key = await resolveKey(ctx, names)
  if (!key) return unavailable(route, 'missing-credential')

  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  const base = route.endpoint ?? DEFAULT_ENDPOINT
  const organizationId = await discoverOrganization(base, headers)
  const json = await fetchJson(`${base}/v1/organizations/${encodeURIComponent(organizationId)}/billing`, { headers })

  const amount = walletBalance(json?.balance?.available)
  const cycleUsage = decimalAmount(json?.current_period?.actual_charged)
  if (json?.ok !== true || amount === undefined || cycleUsage === undefined) {
    throw new Error('invalid quota response')
  }

  const result = {
    ok: true,
    provider: route.provider,
    kind: 'balance',
    service: 'radius',
    currency: typeof json.currency === 'string' && json.currency ? json.currency : 'USD',
    amount,
    cycleUsage,
    updatedAt: nowIso(),
  }
  const creditBalance = walletBalance(json.balance?.credit_balance)
  const reserved = walletBalance(json.balance?.reserved)
  const allTimeCharged = decimalAmount(json.all_time?.actual_charged)
  if (creditBalance !== undefined) result.creditBalance = creditBalance
  if (reserved !== undefined) result.reserved = reserved
  if (allTimeCharged !== undefined) result.allTimeCharged = allTimeCharged
  return result
}

/**
 * Radius keys are scoped to exactly one selected organization, so the
 * organizations list resolves the organization id for the billing path.
 */
async function discoverOrganization(base, headers) {
  const json = await fetchJson(`${base}/v1/organizations`, { headers })
  const organizations = Array.isArray(json?.organizations) ? json.organizations : undefined
  if (!organizations || organizations.length === 0) throw new Error('invalid quota response')
  const selected = organizations.find((organization) => organization?.selected === true) ?? organizations[0]
  const id = typeof selected?.id === 'string' && selected.id ? selected.id : undefined
  if (!id) throw new Error('invalid quota response')
  return id
}
