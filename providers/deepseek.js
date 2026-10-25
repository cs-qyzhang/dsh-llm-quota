/**
 * DeepSeek API Key balance (pay-as-you-go).
 */

import { fetchJson, nowIso, resolveKey, unavailable, walletBalance } from './shared.js'

export const kind = 'deepseek'
export const hosts = {
  'api.deepseek.com': 'https://api.deepseek.com/user/balance',
}

export async function read(ctx, route) {
  const key = await resolveKey(ctx, route.keyNames)
  if (!key) return unavailable(route, 'missing-credential')

  const json = await fetchJson(route.endpoint, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : []
  const wallets = infos.flatMap((info) => {
    const balance = walletBalance(info?.total_balance)
    return balance === undefined ? [] : [{ currency: info.currency, balance }]
  })
  const primary = wallets.find((wallet) => wallet.currency === 'CNY') ?? wallets[0]
  if (!primary) throw new Error('empty balance response')

  return {
    ok: true,
    provider: route.provider,
    kind: 'balance',
    currency: primary.currency,
    amount: primary.balance,
    wallets,
    available: typeof json?.is_available === 'boolean' ? json.is_available : undefined,
    updatedAt: nowIso(),
  }
}
