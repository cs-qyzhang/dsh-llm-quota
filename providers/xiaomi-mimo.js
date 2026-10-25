/**
 * Xiaomi MiMo open platform: pay-as-you-go balance plus Token Plan credits.
 *
 * Both figures live behind the platform console session; the inference API key
 * (`sk-*`) and Token Plan keys (`tp-*` / `ttp-*`) cannot query them. This
 * adapter therefore reads a console cookie from the credential store.
 */

import {
  clampPercent,
  fetchJson,
  nowIso,
  resolveKey,
  toIso,
  unavailable,
  walletBalance,
} from './shared.js'

export const kind = 'xiaomi-mimo'
export const hosts = {}

export const DEFAULT_ENDPOINT = 'https://platform.xiaomimimo.com/api/v1'
export const COOKIE_NAMES = ['MIMO_COOKIE', 'XIAOMI_MIMO_COOKIE']

const PLAN_NAME = 'plan_total_token'
const MONTH_NAME = 'month_total_token'
const COMPENSATION_NAME = 'compensation_total_token'

export async function read(ctx, route) {
  const cookie = await resolveKey(ctx, route.keyNames)
  if (!cookie) return unavailable(route, 'missing-cookie')

  const base = baseEndpoint(route.endpoint)
  const headers = {
    Accept: 'application/json',
    Cookie: normalizeCookie(cookie),
    'x-timezone': timezone(),
  }

  const [balance, usage, detail, profile] = await Promise.all([
    request(`${base}/balance`, headers),
    request(`${base}/tokenPlan/usage`, headers),
    request(`${base}/tokenPlan/detail`, headers),
    request(`${base}/userProfile`, headers),
  ])

  const ledger = balance.value ?? {}
  const plan = fromPlan(usage.value, detail.value)
  const amount = money(ledger.balance) ?? money(ledger.cashBalance)
  const cashBalance = money(ledger.cashBalance)
  const giftBalance = money(ledger.giftBalance)
  const frozenBalance = money(ledger.frozenBalance)

  if (amount === undefined && cashBalance === undefined && !plan) {
    const failure = balance.error ?? usage.error ?? detail.error
    throw failure instanceof Error ? failure : new Error('invalid quota response')
  }

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    currency: currencyOf(profile.value, ledger),
    updatedAt: nowIso(),
  }
  if (amount !== undefined) result.amount = amount
  if (cashBalance !== undefined) result.cashBalance = cashBalance
  if (giftBalance !== undefined) result.giftBalance = giftBalance
  if (frozenBalance !== undefined) result.frozenBalance = frozenBalance
  if (plan) result.plan = plan
  return result
}

async function request(url, headers) {
  try {
    return { value: unwrap(await fetchJson(url, { headers })) }
  } catch (error) {
    return { error }
  }
}

function unwrap(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined
  if (json.code !== undefined && Number(json.code) !== 0) {
    throw new Error(json.message || `business code ${json.code}`)
  }
  return json.data ?? json
}

function fromPlan(usage, detail) {
  if (!usage || typeof usage !== 'object') return undefined
  const resetAt = toIso(detail?.currentPeriodEnd ?? detail?.expireTime ?? detail?.nextResetTime)
  const total = windowOf(usage.usage, PLAN_NAME, resetAt)
  const month = windowOf(usage.monthUsage, MONTH_NAME)
  const compensation = windowOf(usage.usage, COMPENSATION_NAME, resetAt)
  const primary = total ?? month
  if (!primary && !compensation) return undefined

  const plan = {}
  if (primary) {
    if (primary.used !== undefined) plan.used = primary.used
    if (primary.limit !== undefined) plan.limit = primary.limit
    plan.usedPercent = primary.usedPercent
    plan.remainingPercent = primary.remainingPercent
    if (primary.resetAt) plan.resetAt = primary.resetAt
  }
  if (typeof detail?.planName === 'string') plan.name = detail.planName
  if (month) plan.month = month
  if (compensation) plan.compensation = compensation
  return plan
}

function windowOf(section, name, resetAt) {
  if (!section || typeof section !== 'object') return undefined
  const items = Array.isArray(section.items) ? section.items.filter(Boolean) : []
  const item = items.find((entry) => entry.name === name)
    ?? items.find((entry) => entry.name !== COMPENSATION_NAME)
  const window = item ? fromItem(item, resetAt) : undefined
  if (window) return window
  if (typeof section.percent === 'number' && Number.isFinite(section.percent)) {
    const usedPercent = clampPercent(Math.round(section.percent * 100))
    return {
      usedPercent,
      remainingPercent: clampPercent(100 - usedPercent),
      resetAt,
    }
  }
  return undefined
}

function fromItem(item, resetAt) {
  const used = Number(item.used)
  const limit = Number(item.limit)
  let usedPercent
  if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) {
    usedPercent = clampPercent(Math.round((used / limit) * 100))
  } else if (typeof item.percent === 'number' && Number.isFinite(item.percent)) {
    usedPercent = clampPercent(Math.round(item.percent * 100))
  } else {
    return undefined
  }
  return {
    used: Number.isFinite(used) ? used : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt,
  }
}

function currencyOf(profile, ledger) {
  if (typeof ledger?.currency === 'string' && ledger.currency) return ledger.currency
  const idc = Number(profile?.idc)
  if (Number.isFinite(idc)) return idc === 310 ? 'CNY' : 'USD'
  return 'CNY'
}

function money(value) {
  const text = walletBalance(value)
  return text === undefined ? undefined : text
}

function baseEndpoint(endpoint) {
  const base = typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : DEFAULT_ENDPOINT
  return base.replace(/\/+$/, '')
}

function normalizeCookie(value) {
  let text = value.trim()
  const prefix = /^cookie\s*:\s*/i.exec(text)
  if (prefix) text = text.slice(prefix[0].length).trim()
  return text.replace(/[\r\n]+/g, ' ')
}

function timezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
