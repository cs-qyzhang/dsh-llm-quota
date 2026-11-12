/**
 * Anthropic month-to-date organization spend (usage-type quota).
 *
 * Anthropic exposes no balance endpoint, so the plugin reports the current
 * UTC month's rated cost from the Admin API cost report. Reading it needs the
 * organization Admin API key (sk-ant-admin...) created in the Claude Console,
 * never the inference API key used for Messages requests; `routeFor` lets the
 * integration side swap the profile's credential reference for that key.
 * Amounts are decimal strings in USD cents ("123.45" = $1.23) and report data
 * lags live usage by about five minutes.
 */

import { currentUtcMonth, decimalAmount } from './shared.js'

export const kind = 'anthropic'
export const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/organizations/cost_report'
export const KEY_NAMES = ['ANTHROPIC_ADMIN_KEY', 'ANTHROPIC_ADMIN_API_KEY']

const USAGE_ENDPOINT = 'https://api.anthropic.com/v1/organizations/usage_report/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_PAGES = 100

export const hosts = {
  'api.anthropic.com': DEFAULT_ENDPOINT,
}

export function routeFor(baseURL) {
  const hostname = hostnameOf(baseURL)
  if (hostname === 'api.anthropic.com' || hostname === 'claude.com') {
    return { endpoint: DEFAULT_ENDPOINT, keyNames: KEY_NAMES }
  }
  return undefined
}

export const view = {
  preset: 'usage', title: 'Anthropic', errors: { 'missing-credential': { key: 'missingAdminKey' } },
  credentials: [{ id: 'admin-key', refs: [...KEY_NAMES, 'OPENAI_ADMIN_KEY', 'OPENAI_ADMIN_API_KEY'], label: { key: 'adminKey' }, hint: { key: 'adminKeyHint' }, placeholder: { key: 'adminKeyPlaceholder' } }],
}

export function route({ inference }) {
  const match = routeFor(inference.baseURL)
  return match ? { kind, ...match } : undefined
}

export async function read({ route, credentials, http, nowIso }, _route) {
  const key = await credentials.resolve(route.keyNames?.length ? route.keyNames : KEY_NAMES)
  if (!key) return { reason: 'missing-credential' }

  const { startIso, endIso } = currentUtcMonth()
  const query = `starting_at=${encodeURIComponent(startIso)}&ending_at=${encodeURIComponent(endIso)}&bucket_width=1d`
  const headers = {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    Accept: 'application/json',
  }
  const base = route.endpoint ?? DEFAULT_ENDPOINT

  // Token counts are best-effort extras; a failing usage report must not sink
  // the cost result.
  const [cost, usage] = await Promise.all([
    fetchPages(http, `${base}?${query}`, headers),
    fetchPages(http, `${USAGE_ENDPOINT}?${query}`, headers).catch(() => undefined),
  ])

  const items = cost.flatMap(costItemsOf)
  let totalCents = 0
  const centsByType = new Map()
  for (const item of items) {
    const cents = Number(item?.amount ?? 0)
    if (!Number.isFinite(cents)) throw new Error('invalid quota response')
    totalCents += cents
    const costType = typeof item?.cost_type === 'string' && item.cost_type ? item.cost_type : 'unknown'
    centsByType.set(costType, (centsByType.get(costType) ?? 0) + cents)
  }

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    currency: 'USD',
    // `amount` is in cents; convert to dollars before normalizing.
    usedAmount: decimalAmount(totalCents / 100),
    updatedAt: nowIso(),
  }
  if (centsByType.size > 0) {
    result.costTypeBreakdown = Object.fromEntries(
      [...centsByType].map(([costType, cents]) => [costType, decimalAmount(cents / 100)]),
    )
  }
  const tokens = usage === undefined
    ? undefined
    : tokensOf(usage.length === 1 ? usage[0] : { data: usage.flatMap((page) => page.data) })
  if (tokens) Object.assign(result, tokens)
  return result
}

async function fetchPages(http, url, headers) {
  const pages = []
  const cursors = new Set()
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const json = await http.json(url, { headers })
    if (!Array.isArray(json?.data)) throw new Error('invalid quota response')
    pages.push(json)
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

/** Flatten the daily buckets of a cost/usage report into their result rows. */
function rowsOf(json) {
  if (Array.isArray(json?.data)) {
    const rows = []
    for (const bucket of json.data) {
      if (!bucket || typeof bucket !== 'object' || !Array.isArray(bucket.results)) {
        throw new Error('invalid quota response')
      }
      rows.push(...bucket.results)
    }
    return rows
  }
  if (Array.isArray(json?.results)) return json.results
  throw new Error('invalid quota response')
}

function costItemsOf(json) {
  return rowsOf(json)
}

/** Best-effort token totals; anything unexpected just drops the extras. */
function tokensOf(json) {
  let rows
  try {
    rows = rowsOf(json)
  } catch {
    return undefined
  }
  if (rows.length === 0) return undefined
  let inputTokens = 0
  let outputTokens = 0
  for (const row of rows) {
    const numbers = [
      Number(row?.uncached_input_tokens ?? 0),
      Number(row?.cache_read_input_tokens ?? 0),
      Number(row?.cache_creation?.ephemeral_5m_input_tokens ?? 0),
      Number(row?.cache_creation?.ephemeral_1h_input_tokens ?? 0),
      Number(row?.output_tokens ?? 0),
    ]
    if (!numbers.every(Number.isFinite)) return undefined
    inputTokens += numbers[0] + numbers[1] + numbers[2] + numbers[3]
    outputTokens += numbers[4]
  }
  return { inputTokens, outputTokens }
}

function hostnameOf(baseURL) {
  try {
    return new URL(baseURL).hostname
  } catch {
    return undefined
  }
}
