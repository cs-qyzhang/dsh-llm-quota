/**
 * OpenAI Codex (legacy) subscription quota via the ChatGPT backend usage API
 * (`GET https://chatgpt.com/backend-api/wham/usage`). This is the 5-hour /
 * weekly-window quota of a ChatGPT plan (plus/pro/team...), not an API-key
 * billing balance.
 *
 * Authenticated with a ChatGPT OAuth access token
 * (`Authorization: Bearer <token>`) plus the `ChatGPT-Account-Id` header.
 * `rate_limit.primary_window` is the 5-hour window and
 * `rate_limit.secondary_window` the weekly window; both report
 * `used_percent` with `reset_at` (or `reset_after_seconds`) for the reset.
 *
 * NOTE: this endpoint is an undocumented internal API reverse-engineered from
 * the openai/codex sources, not a public commitment — its shape or
 * availability may change without notice. `hosts` is intentionally empty:
 * chatgpt.com cannot be auto-mapped by hostname (openai-codex relies on the
 * OAuth special case in resolve.js), so routing goes through `routeFor` path
 * matching or an explicit `config.providers` override.
 */

import { clampPercent, fetchJson, nowIso, resolveKey, toIso, unavailable } from './shared.js'

export const kind = 'openai-codex'
export const hosts = {}

export const KEY_NAMES = ['OPENAI_CODEX_TOKEN', 'OPENAI_CODEX_OAUTH_TOKEN', 'CHATGPT_OAUTH_TOKEN']
export const DEFAULT_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage'

const ACCOUNT_ID_NAMES = ['OPENAI_CODEX_ACCOUNT_ID', 'CHATGPT_ACCOUNT_ID']

/**
 * Map a Codex baseURL to the ChatGPT usage endpoint. Only chatgpt.com URLs
 * whose path contains `/backend-api` are Codex legacy usage routes; anything
 * else returns undefined.
 */
export function routeFor(baseURL) {
  let url
  try {
    url = new URL(baseURL)
  } catch {
    return undefined
  }
  if (url.hostname !== 'chatgpt.com') return undefined
  if (!url.pathname.includes('/backend-api')) return undefined
  return { endpoint: DEFAULT_ENDPOINT, keyNames: KEY_NAMES }
}

export async function read(ctx, route) {
  const names = route.keyNames?.length ? route.keyNames : KEY_NAMES
  const token = await resolveKey(ctx, names)
  const accountId = await resolveKey(ctx, ACCOUNT_ID_NAMES)
  if (!token || !accountId) return unavailable(route, 'missing-credential')

  const json = await fetchJson(route.endpoint ?? DEFAULT_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      'ChatGPT-Account-Id': accountId,
      Accept: 'application/json',
    },
  })

  const rateLimit = json?.rate_limit
  const now = Date.now()
  const fiveHour = fromWindow(rateLimit?.primary_window, now)
  if (!fiveHour) throw new Error('invalid quota response')
  const weekly = fromWindow(rateLimit?.secondary_window, now)

  return {
    ok: true,
    provider: route.provider,
    kind: 'openai-codex',
    planType: typeof json?.plan_type === 'string' ? json.plan_type : undefined,
    fiveHour,
    weekly,
    resetCredits: numberOf(json?.rate_limit_reset_credits?.available_count),
    windows: windowsOf(json, now),
    updatedAt: nowIso(),
  }
}

/** Map one `rate_limit.*_window` entry to the normalized window fragment. */
function fromWindow(entry, nowMs) {
  if (!entry || typeof entry !== 'object') return undefined
  const used = numberOf(entry.used_percent)
  if (used === undefined) return undefined
  const usedPercent = clampPercent(Math.round(used))
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt: toIso(resetTimeOf(entry, nowMs)),
  }
}

/** Prefer the absolute `reset_at`; fall back to `now + reset_after_seconds`. */
function resetTimeOf(entry, nowMs) {
  if (entry.reset_at !== undefined && entry.reset_at !== null) return entry.reset_at
  const seconds = numberOf(entry.reset_after_seconds)
  return seconds === undefined ? undefined : nowMs + seconds * 1000
}

/** Compact summaries of `additional_rate_limits[]` (optional extras). */
function windowsOf(json, nowMs) {
  const list = Array.isArray(json?.additional_rate_limits) ? json.additional_rate_limits : []
  const windows = list
    .map((entry) => {
      const mapped = fromWindow(entry, nowMs)
      if (!mapped) return undefined
      const label = typeof entry?.label === 'string' ? entry.label
        : typeof entry?.type === 'string' ? entry.type
        : typeof entry?.name === 'string' ? entry.name
        : undefined
      return { label, ...mapped }
    })
    .filter(Boolean)
  return windows.length > 0 ? windows : undefined
}

function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
