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

import { currentUtcMonth, decimalAmount } from './shared.js'

export const kind = 'openai'
export const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/organization/costs'
export const KEY_NAMES = ['OPENAI_ADMIN_KEY', 'OPENAI_ADMIN_API_KEY']

const USAGE_ENDPOINT = 'https://api.openai.com/v1/organization/usage/completions'
// Guard against a server that keeps handing out cursors forever. The full
// month should not be truncated silently when the guard is reached.
const MAX_PAGES = 100

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

export const view = {
  preset: 'usage', title: 'OpenAI', errors: { 'missing-credential': { key: 'missingAdminKey' } },
  credentials: [{ id: 'admin-key', refs: ['ANTHROPIC_ADMIN_KEY', 'ANTHROPIC_ADMIN_API_KEY', ...KEY_NAMES], label: { key: 'adminKey' }, hint: { key: 'adminKeyHint' }, placeholder: { key: 'adminKeyPlaceholder' } }],
}

export function route({ inference }) {
  const match = routeFor(inference.baseURL)
  return match ? { kind, ...match } : undefined
}

export async function read({ route, credentials, http, nowIso }, _route) {
  const key = await credentials.resolve(route.keyNames?.length ? route.keyNames : KEY_NAMES)
  if (!key) return { reason: 'missing-credential' }

  const { startIso, endIso } = currentUtcMonth()
  const query = `start_time=${toUnixSeconds(startIso)}&end_time=${toUnixSeconds(endIso)}&bucket_width=1d`
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  const base = route.endpoint ?? DEFAULT_ENDPOINT

  // Token counts are best-effort extras; a failing usage call must not sink
  // the cost result.
  const [pages, usage] = await Promise.all([
    fetchPages(http, `${base}?${query}`, headers),
    http.json(`${USAGE_ENDPOINT}?${query}`, { headers }).then(async (first) => {
      const rest = await fetchPages(http, `${USAGE_ENDPOINT}?${query}`, headers, 'data', first)
      return { ...first, data: rest.flat() }
    }).catch(() => undefined),
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

/** Walk every page, rejecting cursor loops or truncated reports. */
async function fetchPages(http, url, headers, field = 'results', first) {
  const pages = []
  const cursors = new Set()
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const json = page === 0 && first ? first : await http.json(url, { headers })
    if (!Array.isArray(json?.[field])) throw new Error('invalid quota response')
    pages.push(json[field])
    const cursor = typeof json.next_page === 'string' && json.next_page ? json.next_page : undefined
    if (!json.has_more) return pages
    if (!cursor || cursors.has(cursor)) throw new Error('invalid quota pagination')
    cursors.add(cursor)
    const next = new URL(url)
    next.searchParams.set('page', cursor)
    url = next.toString()
  }
  throw new Error('quota response exceeds pagination limit')
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
