/**
 * Xiaomi MiMo open platform.
 *
 * MiMo exposes two separate products with different DSH providers:
 *   - pay-as-you-go (`api.xiaomimimo.com`) reports the wallet balance;
 *   - Token Plan (`token-plan-*.xiaomimimo.com`) reports plan credits.
 *
 * Both figures live behind the platform console session; the inference API key
 * (`sk-*`) and Token Plan keys (`tp-*` / `ttp-*`) cannot query them. This
 * adapter therefore reads a console cookie from the credential store and, when
 * the provider type is known, only calls the matching console endpoints.
 */

import { clampPercent, nowIso, toIso, walletBalance } from './shared.js'

export const kind = 'xiaomi-mimo'
export const hosts = {}

export const MODE_BALANCE = 'balance'
export const MODE_PLAN = 'plan'

export const DEFAULT_ENDPOINT = 'https://platform.xiaomimimo.com/api/v1'
export const COOKIE_NAMES = ['MIMO_COOKIE', 'XIAOMI_MIMO_COOKIE']

const PLAN_NAME = 'plan_total_token'
const MONTH_NAME = 'month_total_token'
const COMPENSATION_NAME = 'compensation_total_token'
const TOKEN_PLAN_PROVIDER = /(?:^|-)token-plan(?:-|$)/
const XIAOMI_HOST = 'xiaomimimo.com'

/**
 * Infer which console section a MiMo provider bills through.
 *
 * Auto-resolved routes always know the inference host, which is authoritative:
 * `token-plan-*` hosts are the Token Plan and everything else is pay-as-you-go.
 * Explicit `config.providers` overrides only expose the provider id, so fall
 * back to `xiaomi` / `xiaomi-token-plan-*`; other ids stay unspecified and read
 * both sections.
 */
export function billingMode(provider, baseURL) {
  if (typeof baseURL === 'string') {
    const hostname = hostnameOf(baseURL)
    if (hostname && (hostname === XIAOMI_HOST || hostname.endsWith(`.${XIAOMI_HOST}`))) {
      return hostname.startsWith('token-plan') ? MODE_PLAN : MODE_BALANCE
    }
  }
  if (typeof provider === 'string') {
    if (TOKEN_PLAN_PROVIDER.test(provider)) return MODE_PLAN
    if (provider === 'xiaomi') return MODE_BALANCE
  }
  return undefined
}

export const view = {
  preset: 'plan', title: { key: 'mimoTitle' },
  errors: { 'missing-cookie': { key: 'missingCookie' } },
  credentials: [{ id: 'mimo-cookie', refs: COOKIE_NAMES, label: { key: 'mimoCookie' }, hint: { key: 'mimoCookieHint' }, placeholder: { key: 'mimoCookiePlaceholder' } }],
  history: [
    { key: 'amount', path: 'amount', unit: 'currency', label: { key: 'metricAmount' } },
    { key: 'plan', path: 'plan.remainingPercent', unit: 'percent', label: { key: 'metricPlan' } },
    { key: 'plan.month', path: 'plan.month.remainingPercent', unit: 'percent', label: { key: 'mimoMonth' } },
    { key: 'plan.compensation', path: 'plan.compensation.remainingPercent', unit: 'percent', label: { key: 'mimoCompensation' } },
  ],
}

export function route({ provider, profile, inference }) {
  try {
    const url = new URL(inference.baseURL)
    if (url.protocol !== 'https:' || (url.hostname !== XIAOMI_HOST && !url.hostname.endsWith(`.${XIAOMI_HOST}`))) return undefined
  } catch { return undefined }
  return { kind, mode: billingMode(provider, inference.baseURL), endpoint: DEFAULT_ENDPOINT, keyNames: profile.cookieEnv ? [profile.cookieEnv] : COOKIE_NAMES }
}

export function normalizeOverride({ override, provider }) {
  if (override.mode === undefined) override.mode = billingMode(provider)
  return override
}

export function present(data, { message, formatAmount, formatWindow, resetLabel, row }) {
  const title = message('mimoTitle')
  let heading = [title]
  if (data.mode === MODE_BALANCE) heading = [...heading, ' · ', message('mimoPayg')]
  else if (data.mode === MODE_PLAN) heading = [...heading, ' · ', message('mimoTokenPlan'), data.plan?.name ? ` (${data.plan.name})` : '']
  else if (data.plan?.name) heading = [...heading, ' · ', data.plan.name]
  const compact = []
  const badge = []
  if (data.amount !== undefined) {
    compact.push(message('balance', { amount: formatAmount(data.currency, data.amount) }))
    badge.push(formatAmount(data.currency, data.amount))
  }
  if (data.plan && Number.isFinite(data.plan.remainingPercent)) {
    compact.push(message('mimoPlanLeft', { percent: data.plan.remainingPercent }))
    badge.push(message('badgePlan', { percent: data.plan.remainingPercent }))
  }
  const rows = []
  for (const [key, label] of [['amount', 'mimoBalance'], ['cashBalance', 'mimoCash']]) {
    if (data[key] !== undefined) rows.push(row(label, formatAmount(data.currency, data[key])))
  }
  for (const [key, label] of [['giftBalance', 'mimoGift'], ['frozenBalance', 'mimoFrozen']]) {
    if (Number.parseFloat(data[key]) > 0) rows.push(row(label, formatAmount(data.currency, data[key])))
  }
  for (const [label, window] of [['mimoPlan', data.plan], ['mimoMonth', data.plan?.month], ['mimoCompensation', data.plan?.compensation]]) {
    if (window && Number.isFinite(window.remainingPercent)) rows.push(row(label, formatWindow(window), resetLabel(window.resetAt)))
  }
  const joinParts = (parts) => parts.flatMap((entry, index) => index === 0 ? [entry] : [' · ', entry])
  return {
    title: heading,
    gauge: data.mode !== MODE_BALANCE,
    compact: compact.length ? joinParts(compact) : message('error'),
    badge: badge.length ? joinParts(badge) : '',
    rows,
  }
}

export async function read(context) {
  const { route, credentials, http, nowIso } = context
  const request = async (url, headers) => {
    try { return { value: unwrap(await http.json(url, { headers })) } }
    catch (error) { return { error } }
  }
  const cookie = await credentials.resolve(route.keyNames?.length ? route.keyNames : COOKIE_NAMES)
  if (!cookie) return { reason: 'missing-cookie' }

  const base = baseEndpoint(route.endpoint)
  const headers = {
    Accept: 'application/json',
    Cookie: normalizeCookie(cookie),
    'x-timezone': timezone(),
  }

  if (route.mode === MODE_BALANCE) return readBalance(route, base, headers, request)
  if (route.mode === MODE_PLAN) return readPlan(route, base, headers, request)
  return readAll(route, base, headers, request)
}

async function readBalance(route, base, headers, request) {
  const [balance, profile] = await Promise.all([
    request(`${base}/balance`, headers),
    request(`${base}/userProfile`, headers),
  ])

  const ledger = balance.value ?? {}
  const amount = money(ledger.balance) ?? money(ledger.cashBalance)
  const cashBalance = money(ledger.cashBalance)
  const giftBalance = money(ledger.giftBalance)
  const frozenBalance = money(ledger.frozenBalance)

  if (amount === undefined && cashBalance === undefined) {
    const failure = balance.error
    throw failure instanceof Error ? failure : new Error('invalid quota response')
  }

  const result = baseResult(route, MODE_BALANCE)
  result.currency = currencyOf(profile.value, ledger)
  if (amount !== undefined) result.amount = amount
  if (cashBalance !== undefined) result.cashBalance = cashBalance
  if (giftBalance !== undefined) result.giftBalance = giftBalance
  if (frozenBalance !== undefined) result.frozenBalance = frozenBalance
  return result
}

async function readPlan(route, base, headers, request) {
  const [usage, detail] = await Promise.all([
    request(`${base}/tokenPlan/usage`, headers),
    request(`${base}/tokenPlan/detail`, headers),
  ])

  const plan = fromPlan(usage.value, detail.value)
  if (!plan) {
    const failure = usage.error ?? detail.error
    throw failure instanceof Error ? failure : new Error('invalid quota response')
  }

  const result = baseResult(route, MODE_PLAN)
  result.plan = plan
  return result
}

async function readAll(route, base, headers, request) {
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

  const result = baseResult(route)
  result.currency = currencyOf(profile.value, ledger)
  if (amount !== undefined) result.amount = amount
  if (cashBalance !== undefined) result.cashBalance = cashBalance
  if (giftBalance !== undefined) result.giftBalance = giftBalance
  if (frozenBalance !== undefined) result.frozenBalance = frozenBalance
  if (plan) result.plan = plan
  return result
}

function baseResult(route, mode) {
  const result = {
    ok: true,
    provider: route.provider,
    kind,
    updatedAt: nowIso(),
  }
  if (mode) result.mode = mode
  return result
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

function hostnameOf(baseURL) {
  try {
    return new URL(baseURL).hostname
  } catch {
    return undefined
  }
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
