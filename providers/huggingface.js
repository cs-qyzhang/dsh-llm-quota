/**
 * Hugging Face month-to-date billing usage (pay-as-you-go).
 *
 * Hugging Face has no credit-balance endpoint; the Hub billing usage API
 * reports the rated usage of a date range, so the plugin shows the current
 * UTC month's spend in USD together with request and token counts.
 *
 * `GET /api/settings/billing/usage-v2` takes required `startDate`/`endDate`
 * query parameters as integer Unix timestamps (seconds) and its response
 * schema is not published in the Hub OpenAPI spec. This adapter therefore
 * accepts the response shapes documented for the sibling billing endpoints:
 * the per-product usage rows of `/api/settings/billing/usage` (money in
 * `totalCostMicroUSD`) and the per-period usage rows of
 * `/api/organizations/{name}/billing/usage/inference` (money in `costCents`,
 * counts in `requestCount`/`inputTokens`/`outputTokens`/`cachedInputTokens`).
 */

import { currentUtcMonth, decimalAmount, fetchJson, nowIso, resolveKey, unavailable } from './shared.js'

export const kind = 'huggingface'
export const hosts = {
  'router.huggingface.co': 'https://huggingface.co/api/settings/billing/usage-v2',
}
export const KEY_NAMES = ['HF_TOKEN', 'HUGGINGFACE_TOKEN']

// Money fields on usage rows: name -> USD divisor.
const MONEY_FIELDS = {
  costCents: 100,
  totalCostMicroUSD: 1e6,
  totalCostMicroUsd: 1e6,
}
const COUNT_FIELDS = ['requestCount', 'inputTokens', 'outputTokens', 'cachedInputTokens']
const ROW_LIST_KEYS = ['usage', 'sessions']
const CREDITS_FIELDS = {
  creditsRemaining: 1,
  remainingCredits: 1,
  creditsRemainingCents: 100,
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, Array.isArray(route.keyNames) && route.keyNames.length > 0 ? route.keyNames : KEY_NAMES)
  if (!key) return unavailable(route, 'missing-credential')

  const { startIso, endIso } = currentUtcMonth()
  const query = `startDate=${toUnixSeconds(startIso)}&endDate=${toUnixSeconds(endIso)}`
  const json = await fetchJson(`${route.endpoint}?${query}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })

  const rows = collectRows(json)
  let totalUsd = 0
  let hasMoney = false
  const counts = {}
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid quota response')
    for (const [field, divisor] of Object.entries(MONEY_FIELDS)) {
      if (!(field in row)) continue
      const value = Number(row[field])
      if (!Number.isFinite(value)) throw new Error('invalid quota response')
      totalUsd += value / divisor
      hasMoney = true
    }
    for (const field of COUNT_FIELDS) {
      if (!(field in row)) continue
      const value = Number(row[field])
      if (!Number.isFinite(value)) throw new Error('invalid quota response')
      counts[field] = (counts[field] ?? 0) + value
    }
  }

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    updatedAt: nowIso(),
  }
  if (hasMoney) {
    result.currency = 'USD'
    result.usedAmount = decimalAmount(totalUsd)
  } else {
    // Rows carry only request/token counts: report them without inventing money.
    result.usageOnly = true
  }
  for (const field of COUNT_FIELDS) {
    if (counts[field] !== undefined) result[field] = counts[field]
  }

  const credits = readCredits(json)
  if (credits !== undefined) result.creditsRemaining = credits
  return result
}

/**
 * Flatten the usage rows out of the documented billing response shapes:
 * `{usage: rows | {group: rows}, period}`, `{periods: [{period, usage|sessions: rows}]}`
 * or a bare array of one of those period objects (or of rows).
 */
function collectRows(json) {
  const rows = []
  let recognized = false
  const containers = []

  if (Array.isArray(json)) {
    recognized = true
    for (const item of json) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid quota response')
      if (ROW_LIST_KEYS.some((key) => key in item) || 'periods' in item) {
        containers.push(item)
      } else {
        rows.push(item)
      }
    }
  } else if (json && typeof json === 'object') {
    containers.push(json)
    if (Array.isArray(json.periods)) {
      recognized = true
      containers.push(...json.periods)
    }
  } else {
    throw new Error('invalid quota response')
  }

  for (const container of containers) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) throw new Error('invalid quota response')
    for (const key of ROW_LIST_KEYS) {
      if (!(key in container)) continue
      recognized = true
      const value = container[key]
      if (Array.isArray(value)) {
        rows.push(...value)
      } else if (value && typeof value === 'object') {
        // `{usage: {Endpoints: rows, Spaces: rows}}` grouped shape.
        for (const group of Object.values(value)) {
          if (Array.isArray(group)) rows.push(...group)
        }
      } else {
        throw new Error('invalid quota response')
      }
    }
  }

  if (!recognized) throw new Error('invalid quota response')
  return rows
}

function readCredits(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined
  for (const [field, divisor] of Object.entries(CREDITS_FIELDS)) {
    if (!(field in json)) continue
    const value = Number(json[field])
    if (!Number.isFinite(value)) throw new Error('invalid quota response')
    return decimalAmount(value / divisor)
  }
  return undefined
}

function toUnixSeconds(iso) {
  return Math.floor(Date.parse(iso) / 1000)
}
