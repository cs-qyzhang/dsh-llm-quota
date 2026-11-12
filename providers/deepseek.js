/**
 * DeepSeek API Key balance (pay-as-you-go).
 */

import { walletBalance } from './shared.js'

export const kind = 'deepseek'
export const hosts = {
  'api.deepseek.com': 'https://api.deepseek.com/user/balance',
}

export const services = ['launchEnvironment']
export const view = { preset: 'balance', title: { key: 'balanceTitle' } }

export function route({ provider, profile, inference, services }) {
  if (provider !== 'deepseek-official') return undefined
  const baseURL = inference.baseURL ?? services.launchEnvironment?.get('DEEPSEEK_BASE_URL')?.value ?? 'https://api.deepseek.com/anthropic'
  let url
  try {
    url = new URL(baseURL)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined
  return url.hostname === 'api.deepseek.com'
    ? { kind, endpoint: hosts['api.deepseek.com'], keyNames: inference.keyNames }
    : undefined
}

export async function read({ route, credentials, http, nowIso }, _route) {
  const key = await credentials.resolve(route.keyNames)
  if (!key) return { reason: 'missing-credential' }

  const json = await http.json(route.endpoint, {
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
