/**
 * xAI prepaid balance and current billing-cycle spend.
 *
 * The inference API key cannot read billing, so quota uses the read-only
 * Management Key created in the xAI console. The team is resolved through the
 * key-validation endpoint; keys without a single acting team are rejected
 * instead of guessing across teams. Amounts are USD cents in which a negative
 * accounting total means available prepaid credit.
 */

import { decimalAmount, fetchJson, nowIso, resolveKey, unavailable } from './shared.js'

export const kind = 'xai'
export const DEFAULT_ENDPOINT = 'https://management-api.x.ai'
export const MANAGEMENT_KEY_NAMES = ['XAI_MANAGEMENT_KEY', 'XAI_MANAGEMENT_API_KEY']

export const hosts = {
  'api.x.ai': DEFAULT_ENDPOINT,
  'management-api.x.ai': DEFAULT_ENDPOINT,
}

export function routeFor(baseURL) {
  const hostname = hostnameOf(baseURL)
  if (hostname === 'api.x.ai' || hostname === 'management-api.x.ai') return { endpoint: DEFAULT_ENDPOINT }
  return undefined
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-management-key')

  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  const base = route.endpoint ?? DEFAULT_ENDPOINT
  const validation = await fetchJson(`${base}/auth/management-keys/validation`, { headers })
  const teamId = teamIdOf(validation)
  if (!teamId) throw new Error('management key is not team-scoped')

  const [balance, preview] = await Promise.all([
    fetchJson(`${base}/v1/billing/teams/${teamId}/prepaid/balance`, { headers }),
    fetchJson(`${base}/v1/billing/teams/${teamId}/postpaid/invoice/preview`, { headers }).catch(() => undefined),
  ])

  const totalCents = centsOf(balance?.total?.val)
  if (totalCents === undefined) throw new Error('invalid quota response')

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    currency: 'USD',
    amount: decimalAmount(Math.max(0, -totalCents) / 100),
    updatedAt: nowIso(),
  }
  const spentCents = centsOf(preview?.coreInvoice?.totalWithCorr?.val)
  if (spentCents !== undefined) result.cycleUsage = decimalAmount(Math.max(0, spentCents) / 100)
  return result
}

function teamIdOf(validation) {
  if (validation?.scope === 'SCOPE_TEAM' && typeof validation.scopeId === 'string' && validation.scopeId) {
    return validation.scopeId
  }
  return typeof validation?.teamId === 'string' && validation.teamId ? validation.teamId : undefined
}

function centsOf(value) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function hostnameOf(baseURL) {
  try {
    return new URL(baseURL).hostname
  } catch {
    return undefined
  }
}
