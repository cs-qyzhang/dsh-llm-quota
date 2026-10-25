/**
 * DeepSeek account balance. Credentials belong to the DSH account service, so
 * this adapter has no endpoint, host mapping, or API key reference.
 */

import { nowIso, toWallets, unavailable } from './shared.js'

const ACCOUNT_CLIENT_VERSION = '0.2.1-rc.2'

export const kind = 'account'
export const hosts = {}

export async function read(ctx, route) {
  const account = ctx.get('deepseekAccount')
  if (!account) return unavailable(route, 'unavailable')

  const view = await account.getState()
  if (!view || view.status === 'signed-out') return unavailable(route, 'signed-out')

  const details = await account.getBalance({
    version: ACCOUNT_CLIENT_VERSION,
    locale: 'zh_CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  })
  if (!details) return unavailable(route, 'signed-out')
  if (details.status !== 'ready') throw new Error('account balance unavailable')

  const wallets = toWallets(details.value)
  const bonusWallets = toWallets(details.bonusWallets)
  const primary = wallets.find((wallet) => wallet.currency === 'CNY') ?? wallets[0]

  return {
    ok: true,
    provider: route.provider,
    kind: 'balance',
    currency: primary ? primary.currency : 'CNY',
    amount: primary ? primary.balance : '0',
    wallets,
    bonusWallets,
    updatedAt: nowIso(),
  }
}
