/**
 * GLM Coding Plan quota (Z.AI international and Zhipu CN).
 */

import { clampPercent, toIso } from './shared.js'

export const kind = 'glm'
export const hosts = {
  'api.z.ai': 'https://api.z.ai/api/monitor/usage/quota/limit',
  'open.bigmodel.cn': 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
}

export const view = { preset: 'plan', title: 'GLM' }

export function present(data) {
  const level = typeof data.level === 'string' && data.level ? data.level[0].toUpperCase() + data.level.slice(1) : ''
  return { title: level ? `GLM ${level}` : 'GLM' }
}

export async function read({ route, credentials, http, nowIso }, _route) {
  const key = await credentials.resolve(route.keyNames)
  if (!key) return { reason: 'missing-credential' }

  const json = await http.json(route.endpoint, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  })
  if (json?.success === false) {
    throw new Error(json?.msg || `business code ${json?.code ?? 'unknown'}`)
  }
  const code = json?.code
  if (code !== undefined && Number(code) !== 200) {
    throw new Error(json?.msg || `business code ${code}`)
  }

  const data = json?.data ?? {}
  const limits = Array.isArray(data.limits)
    ? data.limits.filter((limit) => limit && limit.type === 'TOKENS_LIMIT')
    : []
  const five = limits.find((limit) => Number(limit.unit) === 3)
    ?? limits.find((limit) => Number(limit.unit) !== 6)
  const week = limits.find((limit) => Number(limit.unit) === 6)
    ?? limits.find((limit) => limit !== five)
  const fiveHour = fromGlmLimit(five)
  const weekly = fromGlmLimit(week)
  if (!fiveHour && !weekly) throw new Error('invalid quota response')

  return {
    ok: true,
    provider: route.provider,
    kind: 'glm',
    level: typeof data.level === 'string' ? data.level : undefined,
    fiveHour,
    weekly,
    updatedAt: nowIso(),
  }
}

function fromGlmLimit(limit) {
  if (!limit) return undefined
  let used
  if (typeof limit.percentage === 'number') {
    used = limit.percentage
  } else {
    const total = Number(limit.usage)
    const remaining = Number(limit.remaining)
    if (!Number.isFinite(total) || !Number.isFinite(remaining) || total <= 0) return undefined
    used = ((total - remaining) / total) * 100
  }
  if (!Number.isFinite(used)) return undefined
  const usedPercent = clampPercent(Math.round(used))
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt: toIso(limit.nextResetTime),
  }
}
