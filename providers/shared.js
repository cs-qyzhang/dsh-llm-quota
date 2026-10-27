/**
 * Helpers shared by provider adapters: credential lookup, upstream HTTP, cache
 * fingerprints, and the normalized response fragments returned to the browser.
 */

export const REQUEST_TIMEOUT_MS = 5_000

export async function resolveKey(ctx, names) {
  for (const name of names ?? []) {
    const hit = await ctx.credentials.resolve(name)
    if (hit && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
  }
  return undefined
}

export async function fetchJson(url, init) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  let json
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`invalid JSON response (HTTP ${response.status})`)
    }
  }
  if (!response.ok) {
    const message = text ? text.slice(0, 200).replace(/\s+/g, ' ') : ''
    throw new Error(`HTTP ${response.status}${message ? `: ${message}` : ''}`)
  }
  return json
}

export function withCacheKey(route) {
  const keyNames = Array.isArray(route.keyNames)
    ? route.keyNames.filter((name) => typeof name === 'string' && name.length > 0)
    : []
  return {
    ...route,
    keyNames,
    cacheKey: JSON.stringify([route.provider, route.kind, route.endpoint ?? '', route.mode ?? '', keyNames]),
  }
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, value))
}

export function toIso(value) {
  if (value === undefined || value === null) return undefined
  const time = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value)
  if (!Number.isFinite(time)) return undefined
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Current UTC calendar month in the shapes billing APIs ask for: the `YYYY-MM`
 * period label and the day boundaries (end is exclusive of the next day).
 */
export function currentUtcMonth() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const pad = (value) => String(value).padStart(2, '0')
  return {
    month: `${year}-${pad(month + 1)}`,
    startIso: new Date(Date.UTC(year, month, 1)).toISOString(),
    endIso: new Date(Date.UTC(year, month, now.getUTCDate() + 1)).toISOString(),
  }
}

/** Normalize a computed money value to a plain decimal string. */
export function decimalAmount(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? String(Number(number.toFixed(6))) : undefined
}

export function walletBalance(value) {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export function toWallets(wallets) {
  if (!Array.isArray(wallets)) return []
  return wallets.flatMap((wallet) => {
    const balance = walletBalance(wallet?.balance)
    return balance === undefined ? [] : [{ currency: wallet?.currency, balance }]
  })
}

export function unavailable(route, reason) {
  return {
    ok: false,
    provider: route.provider,
    kind: route.kind,
    reason,
    updatedAt: nowIso(),
  }
}

export function nowIso() {
  return new Date().toISOString()
}
