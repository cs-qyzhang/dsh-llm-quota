/**
 * Alibaba Cloud Model Studio (Qwen) Token Plan quota.
 *
 * The Token Plan API key (`sk-sp-*`) is a model-inference key and cannot read
 * plan usage. The official Model Studio CLI reads it from the console gateway
 * with a console access token, so this adapter follows the same console API
 * (`tokenplan/personal/api/v2/usage`) and requires a console token credential.
 */

import { clampPercent, fetchJson, nowIso, resolveKey, toIso, unavailable } from './shared.js'

export const kind = 'qwen'
export const hosts = {}

export const TOKEN_NAMES = ['QWEN_CONSOLE_TOKEN', 'BAILIAN_CONSOLE_TOKEN']

const API_NAME = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage'
const API_QUERY = encodeURIComponent(API_NAME)

const GATEWAYS = {
  'token-plan.cn-beijing.maas.aliyuncs.com': {
    host: 'bailian-cs.console.aliyun.com',
    action: 'BroadScopeAspnGateway',
  },
  'token-plan.ap-southeast-1.maas.aliyuncs.com': {
    host: 'bailian-singapore-cs.alibabacloud.com',
    action: 'IntlBroadScopeAspnGateway',
  },
}

const REGIONS = {
  'bailian-cs.console.aliyun.com': 'cn-beijing',
  'bailian-cs.console.alibabacloud.com': 'cn-beijing',
  'modelstudio-cs.console.aliyun.com': 'ap-southeast-1',
  'bailian-singapore-cs.alibabacloud.com': 'ap-southeast-1',
}

/** Map a Token Plan inference host to its console gateway endpoint. */
export function routeFor(baseURL) {
  const gateway = GATEWAYS[hostnameOf(baseURL)]
  if (!gateway) return undefined
  return {
    endpoint: `https://${gateway.host}/cli/api.json?action=${gateway.action}&product=sfm_bailian&api=${API_QUERY}`,
  }
}

export async function read(ctx, route) {
  const token = await resolveKey(ctx, route.keyNames)
  if (!token) return unavailable(route, 'missing-console-token')

  const params = JSON.stringify({
    Api: API_NAME,
    V: '1.0',
    Data: {
      cornerstoneParam: {
        protocol: 'V2',
        console: 'ONE_CONSOLE',
        productCode: 'p_efm',
        switchUserType: 3,
        consoleSite: 'BAILIAN_ALIYUN',
      },
    },
  })
  const json = await fetchJson(route.endpoint, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${token}`,
    },
    body: new URLSearchParams({ params, region: regionOf(route) }).toString(),
  })
  checkGateway(json)

  const usage = unwrap(json)
  const ratio = numberOf(usage?.per1MonthPercentage)
  if (ratio === undefined) throw new Error('invalid quota response')

  const usedPercent = clampPercent(Math.round(ratio * 100))
  const resetTime = numberOf(usage?.per1MonthResetTime)
  const resetAt = resetTime !== undefined && resetTime > 0 ? toIso(resetTime) : undefined
  const plan = {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
  }
  if (resetAt) plan.resetAt = resetAt

  return {
    ok: true,
    provider: route.provider,
    kind,
    plan,
    updatedAt: nowIso(),
  }
}

function regionOf(route) {
  if (typeof route.region === 'string' && route.region.length > 0) return route.region
  return REGIONS[hostnameOf(route.endpoint)] ?? 'cn-beijing'
}

function checkGateway(json) {
  const data = json?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('invalid quota response')
  }
  if (data.success === false) {
    const code = data.errorCode
    throw new Error(`console gateway error: ${typeof code === 'string' ? code : JSON.stringify(code ?? 'unknown')}`)
  }
}

/** Console gateway wraps most payloads in a DataV2 double envelope. */
function unwrap(json) {
  const data = json?.data
  if (!data || typeof data !== 'object') return undefined
  const dataV2 = data.DataV2
  if (dataV2 && typeof dataV2 === 'object') {
    const inner = dataV2.data
    return inner?.data ?? inner ?? dataV2
  }
  return data.data ?? data
}

function numberOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}
