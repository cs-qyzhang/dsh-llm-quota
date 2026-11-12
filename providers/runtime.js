import * as helpers from './core.js'
import { present } from './presentation.js'

export function defineProvider(plugin) {
  if (!plugin || typeof plugin !== 'object') throw new TypeError('provider plugin must be an object')
  if (typeof plugin.kind !== 'string' || plugin.kind.length === 0) throw new TypeError('provider plugin kind must be a non-empty string')
  if (typeof plugin.read !== 'function') throw new TypeError(`provider plugin ${plugin.kind} must define read()`)
  if (plugin.services !== undefined && (!Array.isArray(plugin.services) || !plugin.services.every((name) => typeof name === 'string'))) {
    throw new TypeError(`provider plugin ${plugin.kind} services must be a string array`)
  }
  return Object.freeze({
    ...plugin,
    [Symbol.for('dsh-llm-quota.provider')]: true,
    allowSpecialBeforeOAuth: plugin.allowSpecialBeforeOAuth ?? typeof plugin.route === 'function',
    services: [...(plugin.services ?? [])],
    async read(ctx, route, signal) {
      const controller = signal ? undefined : new AbortController()
      const timedSignal = signal ?? controller.signal
      const timer = controller
        ? setTimeout(() => controller.abort(new Error('quota request timed out')), helpers.REQUEST_TIMEOUT_MS)
        : undefined
      timer?.unref?.()
      const services = Object.fromEntries((plugin.services ?? []).map((name) => [name, ctx.get?.(name)]))
      let result
      try {
        result = await helpers.abortable(plugin.read({
          route,
          credentials: { resolve: async (names) => helpers.resolveKey(ctx, names) },
          http: { json: (url, init) => helpers.fetchJson(url, { ...init, signal: timedSignal }) },
          services,
          signal: timedSignal,
          nowIso: helpers.nowIso,
        }), timedSignal)
      } finally {
        clearTimeout(timer)
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid provider result')
      const normalized = {
        ...result,
        // `reason` is the failure channel, but an explicit `ok: false` from a
        // custom module must not flip into a cached, history-recorded success.
        ok: result.reason === undefined && result.ok !== false,
        provider: route.provider,
        kind: result.kind ?? plugin.kind,
        updatedAt: helpers.nowIso(),
      }
      return { ...normalized, ...present(plugin, normalized) }
    },
  })
}

export function routeFromBaseURL(registry, provider, baseURL, keyNames) {
  if (typeof baseURL !== 'string') return { provider, reason: 'unavailable' }
  let hostname
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    hostname = url.hostname
  } catch {
    return { provider, reason: 'unavailable' }
  }
  const adapter = registry.byHost.get(hostname)
  if (!adapter) return undefined
  return helpers.withCacheKey({ provider, ...adapter, keyNames })
}

export async function readQuota(registry, ctx, route, signal) {
  const adapter = registry.byKind.get(route.kind)
  if (!adapter) return { ok: false, provider: route.provider, kind: route.kind, reason: 'unsupported' }
  return adapter.read(ctx, route, signal)
}
