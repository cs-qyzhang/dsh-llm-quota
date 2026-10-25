/**
 * Kimi For Coding quota. This is the coding-plan usages endpoint, not the
 * Moonshot open-platform balance API.
 */

import { clampPercent, fetchJson, nowIso, resolveKey, toIso, unavailable } from './shared.js'

export const kind = 'kimi'
export const hosts = {
  'api.kimi.com': 'https://api.kimi.com/coding/v1/usages',
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const json = await fetchJson(route.endpoint, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const usages = json?.usages ?? {}
  let fiveHour = fromUsedRatio(usages.limit_5h)
  let weekly = fromUsedRatio(usages.limit_7d)

  if (!fiveHour || !weekly) {
    const limits = Array.isArray(json?.limits) ? json.limits : []
    if (!fiveHour) {
      const detail = limits.find((entry) => Number(entry?.window?.duration) === 300)?.detail
      fiveHour = fromQuotaDetail(detail)
    }
    if (!weekly) weekly = fromQuotaDetail(json?.usage)
  }
  if (!fiveHour && !weekly) throw new Error('invalid quota response')

  return {
    ok: true,
    provider: route.provider,
    kind: 'kimi',
    fiveHour,
    weekly,
    updatedAt: nowIso(),
  }
}

function fromUsedRatio(entry) {
  if (!entry || typeof entry.used_ratio !== 'number') return undefined
  const usedPercent = clampPercent(Math.round(entry.used_ratio * 100))
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt: toIso(entry.reset_time),
  }
}

function fromQuotaDetail(detail) {
  if (!detail) return undefined
  const total = Number(detail.limit)
  const remaining = Number(detail.remaining)
  if (!Number.isFinite(total) || !Number.isFinite(remaining) || total <= 0) return undefined
  const usedPercent = clampPercent(Math.round(((total - remaining) / total) * 100))
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt: toIso(detail.resetTime ?? detail.reset_time),
  }
}
