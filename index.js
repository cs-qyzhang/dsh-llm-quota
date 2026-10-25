/**
 * Host half of the LLM quota bundle. Credentials stay on the Host; the browser
 * receives only derived balances or coding-plan windows through DSH Connection.
 *
 * Provider-specific compatibility (route resolution, upstream endpoints, and
 * response parsers) lives in ./providers. This file only owns the HTTP route,
 * caching, and normalized error responses.
 */

import { readQuota } from './providers/index.js'
import { resolveRoute } from './providers/resolve.js'
import { REQUEST_TIMEOUT_MS, nowIso, unavailable } from './providers/shared.js'

const ROUTE_PATH = '/api/llm-quota'
const CACHE_TTL_MS = 30_000
const CACHE_MAX_ENTRIES = 50

export const inject = ['connection', 'credentials', 'llm', 'loader']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ providers?: Record<string, object>, cacheSeconds?: number }} [config]
 */
export function apply(ctx, config = {}) {
  const overrides = config.providers && typeof config.providers === 'object' ? config.providers : undefined
  const ttl = Number.isFinite(config.cacheSeconds) ? Math.max(0, config.cacheSeconds) * 1000 : CACHE_TTL_MS
  const cache = new Map()
  const pending = new Map()

  ctx.effect(
    () => ctx.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => serve(ctx, request, { overrides, ttl, cache, pending }),
    }),
    'llm-quota: quota route',
  )
}

async function serve(ctx, request, options) {
  let provider = ''
  try {
    provider = (new URL(request.url).searchParams.get('provider') || '').trim()
  } catch {}
  if (!provider) provider = defaultProvider(ctx)
  if (!provider || provider.length > 128) {
    return send({ ok: false, provider, reason: 'unsupported' })
  }

  let route
  try {
    route = resolveRoute(ctx, provider, options.overrides)
  } catch (error) {
    return send(failure(provider, error))
  }
  if (!route) return send({ ok: false, provider, reason: 'unsupported' })
  if (route.reason) return send(unavailable(route, route.reason))

  const cached = options.cache.get(route.cacheKey)
  if (cached && Date.now() - cached.at < options.ttl) {
    options.cache.delete(route.cacheKey)
    options.cache.set(route.cacheKey, cached)
    return send(cached.value)
  }

  try {
    let task = options.pending.get(route.cacheKey)
    if (!task) {
      task = (async () => {
        try {
          const value = await withTimeout(readQuota(ctx, route), REQUEST_TIMEOUT_MS)
          if (value?.ok === true) writeCache(options.cache, route.cacheKey, value)
          else options.cache.delete(route.cacheKey)
          return value
        } finally {
          if (options.pending.get(route.cacheKey) === task) options.pending.delete(route.cacheKey)
        }
      })()
      options.pending.set(route.cacheKey, task)
    }
    return send(await task)
  } catch (error) {
    if (cached) return send({ ...cached.value, stale: true })
    return send(failure(provider, error, route.kind))
  }
}

function writeCache(cache, key, value) {
  cache.delete(key)
  cache.set(key, { at: Date.now(), value })
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value)
  }
}

function withTimeout(promise, milliseconds) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('quota request timed out')), milliseconds)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

function defaultProvider(ctx) {
  try {
    return ctx.get('agentDefaultModel')?.currentSelection()?.provider ?? 'deepseek-account'
  } catch {
    return 'deepseek-account'
  }
}

function failure(provider, error, kind) {
  return {
    ok: false,
    provider,
    kind,
    reason: 'error',
    error: errorText(error),
    updatedAt: nowIso(),
  }
}

function send(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function errorText(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 300)
}
