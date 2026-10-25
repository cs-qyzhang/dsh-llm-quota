/**
 * Moonshot / Kimi open-platform balance (pay-as-you-go).
 *
 * This is the wallet behind `api.moonshot.cn` / `api.moonshot.ai`, not the
 * Kimi For Coding subscription quota handled by `kimi.js`.
 */

import { fetchJson, nowIso, resolveKey, unavailable, walletBalance } from './shared.js'

export const kind = 'moonshot'
export const hosts = {
  'api.moonshot.cn': 'https://api.moonshot.cn/v1/users/me/balance',
  'api.moonshot.ai': 'https://api.moonshot.ai/v1/users/me/balance',
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const json = await fetchJson(route.endpoint, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (json?.status === false || (json?.code !== undefined && Number(json.code) !== 0)) {
    throw new Error(json?.error?.message || json?.message || `business code ${json?.code ?? json?.scode ?? 'unknown'}`)
  }

  const data = json?.data ?? {}
  const amount = walletBalance(data.available_balance)
  if (amount === undefined) throw new Error('invalid quota response')

  const currency = currencyOf(route.endpoint)
  const cash = walletBalance(data.cash_balance)
  const voucher = walletBalance(data.voucher_balance)
  const result = {
    ok: true,
    provider: route.provider,
    kind: 'balance',
    service: 'moonshot',
    currency,
    amount,
    wallets: cash === undefined ? [] : [{ currency, balance: cash }],
    bonusWallets: voucher === undefined ? [] : [{ currency, balance: voucher }],
    available: Number.parseFloat(amount) > 0,
    updatedAt: nowIso(),
  }
  return result
}

function currencyOf(endpoint) {
  try {
    return new URL(endpoint).hostname.endsWith('.cn') ? 'CNY' : 'USD'
  } catch {
    return 'USD'
  }
}
