/**
 * MiniMax Coding Plan / M Plan quota. Usage is measured in prompts, counted in
 * a dynamic 5-hour window plus a weekly window; both figures come from the
 * subscription key used for inference.
 */

import { clampPercent, fetchJson, nowIso, resolveKey, toIso, unavailable } from './shared.js'

export const kind = 'minimax'
export const hosts = {
  'api.minimax.io': 'https://api.minimax.io/v1/token_plan/remains',
  'api.minimaxi.com': 'https://api.minimaxi.com/v1/token_plan/remains',
}

const PLAN_PATHS = ['/v1/token_plan/remains', '/v1/coding_plan/remains']

const FIVE_HOUR = {
  percentField: 'current_interval_remaining_percent',
  totalField: 'current_interval_total_count',
  remainingField: 'current_interval_usage_count',
  endField: 'end_time',
  remainsField: 'remains_time',
}

const WEEKLY = {
  percentField: 'current_weekly_remaining_percent',
  totalField: 'current_weekly_total_count',
  remainingField: 'current_weekly_usage_count',
  endField: 'weekly_end_time',
  remainsField: 'weekly_remains_time',
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const json = await readRemains(route.endpoint, key)
  const row = canonicalRow(json?.model_remains)
  const fiveHour = windowOf(row, FIVE_HOUR)
  const weekly = windowOf(row, WEEKLY)
  if (!fiveHour && !weekly) throw new Error('invalid quota response')

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    fiveHour,
    weekly,
    updatedAt: nowIso(),
  }
  if (typeof row?.model_name === 'string' && row.model_name.length > 0) result.model = row.model_name
  return result
}

/**
 * The newer M Plan endpoint and the legacy Coding Plan endpoint share a payload
 * but not every subscription key is accepted by both, so try the documented
 * sibling before failing. Custom endpoints outside these paths are used as-is.
 */
async function readRemains(endpoint, key) {
  let lastError
  for (const candidate of candidatesFor(endpoint)) {
    try {
      const json = await fetchJson(candidate, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      })
      checkBusinessCode(json)
      return json
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('invalid quota response')
}

function candidatesFor(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) return []
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return [endpoint]
  }
  if (!PLAN_PATHS.includes(url.pathname)) return [endpoint]
  return [
    endpoint,
    ...PLAN_PATHS.filter((path) => path !== url.pathname).map((path) => `${url.origin}${path}`),
  ]
}

function checkBusinessCode(json) {
  const code = json?.base_resp?.status_code
  if (code !== undefined && Number(code) !== 0) {
    throw new Error(json?.base_resp?.status_msg || `business code ${code}`)
  }
}

/**
 * The first entry carries the canonical account state; later entries describe
 * narrower buckets such as video models. Skip an entry only when it exposes no
 * usable window at all.
 */
function canonicalRow(rows) {
  if (!Array.isArray(rows)) return undefined
  return rows.find((row) => hasWindow(row, FIVE_HOUR) || hasWindow(row, WEEKLY)) ?? rows[0]
}

function hasWindow(row, spec) {
  return percentOf(row?.[spec.percentField]) !== undefined || totalOf(row, spec.totalField) > 0
}

function windowOf(row, spec) {
  if (!row) return undefined
  let usedPercent
  const reported = percentOf(row[spec.percentField])
  if (reported !== undefined) {
    usedPercent = clampPercent(Math.round(100 - reported))
  } else {
    const total = totalOf(row, spec.totalField)
    const remaining = clampedRemaining(row, spec.remainingField, total)
    if (total <= 0 || remaining === undefined) return undefined
    usedPercent = clampPercent(Math.round(((total - remaining) / total) * 100))
  }
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt: resetAt(row, spec),
  }
}

function resetAt(row, spec) {
  const absolute = row?.[spec.endField]
  if (absolute !== undefined && absolute !== null && Number(absolute) !== 0) {
    const iso = toIso(absolute)
    if (iso) return iso
  }
  const remaining = Number(row?.[spec.remainsField])
  if (Number.isFinite(remaining) && remaining > 0) {
    return new Date(Date.now() + remaining).toISOString()
  }
  return undefined
}

function percentOf(value) {
  const percent = numberOf(value)
  return percent !== undefined && percent >= 0 && percent <= 100 ? percent : undefined
}

function totalOf(row, field) {
  const total = numberOf(row?.[field])
  return total !== undefined && total > 0 ? total : 0
}

function clampedRemaining(row, field, total) {
  const remaining = numberOf(row?.[field])
  if (remaining === undefined) return undefined
  return Math.max(0, Math.min(total, remaining))
}

function numberOf(value) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}
