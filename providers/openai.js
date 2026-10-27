/**
 * OpenAI month-to-date organization costs (usage-type quota).
 *
 * OpenAI exposes no balance endpoint, so the plugin reports the current
 * UTC month's rated cost from the Organization Costs API. Reading it needs
 * the Admin API key (sk-admin...) created in the organization admin-keys
 * settings, never the inference API key used for Responses/Chat requests;
 * `routeFor` lets the integration side swap the profile's credential
 * reference for that key. Amounts are decimal USD values and cost data
 * lags live usage for a short while.
 */

import { currentUtcMonth, decimalAmount, fetchJson, nowIso, resolveKey, unavailable } from './shared.js'

export const kind = 'openai'
export const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/organization/costs'
export const KEY_NAMES = ['OPENAI_ADMIN_KEY', 'OPENAI_ADMIN_API_KEY']

const USAGE_ENDPOINT = 'https://api.openai.com/v1/organization/usage/completions'
// Guard against a server that keeps handing out cursors forever.
const MAX_PAGES = 5

export const hosts = {
  'api.openai.com': DEFAULT_ENDPOINT,
}

export function routeFor(baseURL) {
  const hostname = hostnameOf(baseURL)
  if (hostname === 'api.openai.com') {
    return { endpoint: DEFAULT_ENDPOINT, keyNames: KEY_NAMES }
  }
  return undefined
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames?.length ? route.keyNames : KEY_NAMES)
  if (!key) return unavailable(route, 'missing-credential')

  const { startIso, endIso } = currentUtcMonth()
  const query = `start_time=${toUnixSeconds(startIso)}&end_time=${toUnixSeconds(endIso)}&bucket_width=1d`
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  const base = route.endpoint ?? DEFAULT_ENDPOINT

  // Token counts are best-effort extras; a failing usage call must not sink
  // the cost result.
  const [pages, usage] = await Promise.all([
    fetchCostPages(`${base}?${query}`, headers),
    fetchJson(`${USAGE_ENDPOINT}?${query}`, { headers }).catch(() => undefined),
  ])

  let total = 0
  for (const results of pages) {
    for (const result of results) {
      const value = Number(result?.amount?.value ?? 0)
      if (!Number.isFinite(value)) throw new Error('invalid quota response')
      total += value
    }
  }

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    currency: 'USD',
    usedAmount: decimalAmount(total),
    updatedAt: nowIso(),
  }
  const extras = extrasOf(usage)
  if (extras) Object.assign(result, extras)
  return result
}

/** Walk the costs pagination cursors and collect every page's result rows. */
async function fetchCostPages(url, headers) {
  const pages = []
  let pageUrl = url
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const json = await fetchJson(pageUrl, { headers })
    if (!Array.isArray(json?.results)) throw new Error('invalid quota response')
    pages.push(json.results)
    const cursor = typeof json.next_page === 'string' && json.next_page ? json.next_page : undefined
    if (!json.has_more || !cursor) return pages
    pageUrl = `${url}&page=${encodeURIComponent(cursor)}`
  }
  return pages
}

/** Best-effort token/request totals; anything unexpected just drops the extras. */
function extrasOf(json) {
  if (!json || typeof json !== 'object') return undefined
  let rows = []
  try {
    if (Array.isArray(json.data)) {
      for (const bucket of json.data) {
        if (!bucket || !Array.isArray(bucket.results)) return undefined
        rows.push(...bucket.results)
      }
    } else if (Array.isArray(json.results)) {
      rows = json.results
    } else {
      return undefined
    }
  } catch {
    return undefined
  }
  if (rows.length === 0) return undefined
  let inputTokens = 0
  let outputTokens = 0
  let requestCount = 0
  for (const row of rows) {
    const numbers = [
      Number(row?.input_tokens ?? 0),
      Number(row?.output_tokens ?? 0),
      Number(row?.num_model_requests ?? 0),
    ]
    if (!numbers.every(Number.isFinite)) return undefined
    inputTokens += numbers[0]
    outputTokens += numbers[1]
    requestCount += numbers[2]
  }
  return { inputTokens, outputTokens, requestCount }
}

function toUnixSeconds(iso) {
  return Math.floor(Date.parse(iso) / 1000)
}

function hostnameOf(baseURL) {
  try {
    return new URL(baseURL).hostname
  } catch {
    return undefined
  }
}
