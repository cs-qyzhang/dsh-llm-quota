/**
 * OpenCode Go subscription quota (opencode.ai Zen Go usage endpoint).
 *
 * The endpoint is `GET /zen/go/v1/usage` on opencode.ai and answers with three
 * billing windows: `rolling` (5-hour rolling window, 20% of the monthly cap),
 * `weekly` (50%), and `monthly` (100%). Each window carries
 * `status: "ok" | "rate-limited"`, `percent` (0-100), and `resetsAt` (ISO 8601).
 *
 * `percent` is the USED share of the window cap, not the remaining share:
 * community consumers of the same upstream route (opencode-plan-usage,
 * dsh-llm-opencode-go-live overlay design) render it as a usage progress bar
 * that reads 0% on a fresh window and fills to 100% when
 * `status: "rate-limited"` kicks in. Hence `usedPercent = percent` and
 * `remainingPercent = 100 - percent`.
 *
 * `hosts` is intentionally empty: OpenCode Zen and Go share the opencode.ai
 * hostname, so host matching cannot tell them apart. Routing distinguishes Go
 * by URL path via `routeFor` (integration side, `resolve.js`).
 */

import { clampPercent, fetchJson, nowIso, resolveKey, toIso, unavailable } from './shared.js'

export const kind = 'opencode-go'
export const hosts = {}

export const KEY_NAMES = ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY']
export const DEFAULT_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'

/**
 * Map an OpenCode baseURL to the Go usage endpoint. Only `/zen/go` paths are
 * Go; plain `/zen` URLs are the prepaid Zen product and return undefined.
 */
export function routeFor(baseURL) {
  let url
  try {
    url = new URL(baseURL)
  } catch {
    return undefined
  }
  if (url.hostname !== 'opencode.ai') return undefined
  const path = url.pathname.replace(/\/+$/, '')
  if (path !== '/zen/go' && !path.startsWith('/zen/go/')) return undefined
  return { endpoint: DEFAULT_ENDPOINT }
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames ?? KEY_NAMES)
  if (!key) return unavailable(route, 'missing-credential')

  const endpoint = route.endpoint ?? DEFAULT_ENDPOINT
  const json = await fetchJson(endpoint, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const usage = json?.usage
  const fiveHour = fromWindow(usage?.rolling)
  const weekly = fromWindow(usage?.weekly)
  const monthly = fromWindow(usage?.monthly)
  if (!fiveHour || !weekly) throw new Error('invalid quota response')

  const result = {
    ok: true,
    provider: route.provider,
    kind: 'opencode-go',
    fiveHour,
    weekly,
    updatedAt: nowIso(),
  }
  if (monthly) result.monthly = monthly
  if (isRateLimited(usage)) result.status = 'rate-limited'
  return result
}

function fromWindow(entry) {
  if (!entry || typeof entry !== 'object') return undefined
  const percent = Number(entry.percent)
  if (!Number.isFinite(percent)) return undefined
  const usedPercent = clampPercent(Math.round(percent))
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt: toIso(entry.resetsAt),
  }
}

function isRateLimited(usage) {
  return [usage?.rolling, usage?.weekly, usage?.monthly].some(
    (entry) => entry?.status === 'rate-limited',
  )
}
