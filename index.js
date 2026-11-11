/**
 * Host half of the LLM quota bundle. Credentials stay on the Host; the browser
 * receives only derived balances or coding-plan windows through DSH Connection.
 *
 * Provider-specific compatibility (route resolution, upstream endpoints, and
 * response parsers) lives in ./providers. This file only owns the HTTP route,
 * caching, and normalized error responses.
 */

import { readdirSync, readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import {
  createHistoryCollector,
  createHistoryStore,
  defaultHistoryPath,
  historyIntervalMs,
  sampleHistoryPoints,
} from './history.js'
import { readQuota } from './providers/index.js'
import { resolveRoute } from './providers/resolve.js'
import { REQUEST_TIMEOUT_MS, nowIso, unavailable } from './providers/shared.js'

const ROUTE_PATH = '/api/llm-quota'
const HISTORY_ROUTE_PATH = '/api/llm-quota/history'
const I18N_ROUTE_PATH = '/api/llm-quota/i18n'
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/
const CACHE_TTL_MS = 30_000
const CACHE_MAX_ENTRIES = 50
const HISTORY_RANGES = {
  '1h': { hours: '1' },
  '4h': { hours: '4' },
  '12h': { hours: '12' },
  '1d': { days: '1' },
  '7d': { days: '7' },
  '30d': { days: '30' },
}

export const Config = z.object({
  providers: z.dict(z.object({})).default({}).volatile(),
  cacheSeconds: z.number().default(30).volatile(),
  history: z.boolean().default(true).volatile(),
  historyIntervalSeconds: z.number().default(30).volatile(),
  historyDefaultRange: z.union(Object.keys(HISTORY_RANGES).map((value) => z.const(value))).default('1h').volatile(),
})

export const inject = ['connection', 'credentials', 'llm', 'loader']

function configValue(value) {
  return value && typeof value.get === 'function' ? value.get() : value
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ providers?: Record<string, object>, cacheSeconds?: number, history?: boolean, historyIntervalSeconds?: number, historyDefaultRange?: string }} [config]
 */
export function apply(ctx, config = {}) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.on('loader/volatile-update', () => ctx.fiber.restart())

  const providerConfig = configValue(config.providers)
  const overrides = providerConfig && typeof providerConfig === 'object' ? providerConfig : undefined
  const cacheSeconds = configValue(config.cacheSeconds)
  const ttl = Number.isFinite(cacheSeconds) ? Math.max(0, cacheSeconds) * 1000 : CACHE_TTL_MS
  const history = configValue(config.history) === false
    ? undefined
    : createHistoryStore({ filePath: defaultHistoryPath() })
  const options = {
    overrides,
    ttl,
    cache: new Map(),
    pending: new Map(),
    history,
    historyDefaultRange: normalizeHistoryRange(configValue(config.historyDefaultRange)),
  }

  ctx.effect(
    () => ctx.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => serve(ctx, request, options),
    }),
    'llm-quota: quota route',
  )

  ctx.effect(
    () => ctx.connection.fetch.register({
      path: I18N_ROUTE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => serveDictionaries(),
    }),
    'llm-quota: i18n route',
  )

  if (!history) return
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: HISTORY_ROUTE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => serveHistory(ctx, request, options),
    }),
    'llm-quota: history route',
  )
  const collector = createHistoryCollector({
    ctx,
    overrides,
    resolveRoute,
    intervalMs: historyIntervalMs(configValue(config.historyIntervalSeconds)),
    readRoute: (route, { force } = {}) => readQuotaRoute(ctx, route, options, force),
  })
  ctx.effect(() => {
    collector.start()
    return () => {
      collector.stop()
      history.close()
    }
  }, 'llm-quota: history collector')
}

async function serve(ctx, request, options) {
  const provider = requestProvider(ctx, request)
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
  return send(await readQuotaRoute(ctx, route, options))
}

function normalizeHistoryRange(value) {
  return Object.hasOwn(HISTORY_RANGES, value) ? value : '1h'
}

/**
 * Read the bundle's `locale/*.json` message dictionaries. These files are the
 * single source of truth for every user-facing string: `meta` serves the plugin
 * manager page, `messages` is the runtime namespace dictionary the Client
 * registers through `ctx.locale.register`.
 */
function readDictionaries() {
  const directory = new URL('./locale/', import.meta.url)
  const dictionaries = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const language = entry.name.slice(0, -5)
    if (!LANGUAGE_ID.test(language)) continue
    const parsed = JSON.parse(readFileSync(new URL(entry.name, directory), 'utf8'))
    const messages = parsed?.messages
    if (messages && typeof messages === 'object' && !Array.isArray(messages)) {
      dictionaries[language.toLowerCase()] = messages
    }
  }
  return dictionaries
}

function serveDictionaries() {
  try {
    return send({ ok: true, dictionaries: readDictionaries() })
  } catch (error) {
    return send({ ok: false, reason: 'error', error: errorText(error) })
  }
}

async function serveHistory(ctx, request, options) {
  let days = ''
  let hours = ''
  try {
    const params = new URL(request.url).searchParams
    days = params.get('days') || ''
    hours = params.get('hours') || ''
  } catch {}
  if (!days && !hours) ({ days = '', hours = '' } = HISTORY_RANGES[options.historyDefaultRange])
  if ((days && hours) || (hours ? !['1', '4', '12'].includes(hours) : !['1', '7', '30'].includes(days))) {
    return send({ ok: false, reason: 'invalid-range' })
  }

  const provider = requestProvider(ctx, request)
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

  const rangeMs = hours ? Number(hours) * 3_600_000 : Number(days) * 86_400_000
  const since = new Date(Date.now() - rangeMs).toISOString()
  try {
    const allPoints = await options.history.list(route.cacheKey, since)
    const points = sampleHistoryPoints(allPoints)
    return send({ ok: true, provider, since, points, sampled: points.length < allPoints.length, historyDefaultRange: options.historyDefaultRange })
  } catch (error) {
    return send({
      ok: false,
      provider,
      reason: 'history-unavailable',
      error: errorText(error),
      updatedAt: nowIso(),
    })
  }
}

function requestProvider(ctx, request) {
  let provider = ''
  try {
    provider = (new URL(request.url).searchParams.get('provider') || '').trim()
  } catch {}
  return provider || defaultProvider(ctx)
}

async function readQuotaRoute(ctx, route, options, force = false) {
  const cached = options.cache.get(route.cacheKey)
  if (!force && cached && Date.now() - cached.at < options.ttl) {
    options.cache.delete(route.cacheKey)
    options.cache.set(route.cacheKey, cached)
    return cached.value
  }

  try {
    let task = options.pending.get(route.cacheKey)
    if (!task) {
      task = (async () => {
        try {
          const value = await withTimeout(readQuota(ctx, route), REQUEST_TIMEOUT_MS)
          if (value?.ok === true) {
            if (options.history) {
              try {
                await options.history.record(route.cacheKey, value)
              } catch {
                // History persistence must never make an otherwise valid quota fail.
              }
            }
            writeCache(options.cache, route.cacheKey, value)
          } else {
            options.cache.delete(route.cacheKey)
          }
          return value
        } finally {
          if (options.pending.get(route.cacheKey) === task) options.pending.delete(route.cacheKey)
        }
      })()
      options.pending.set(route.cacheKey, task)
    }
    return await task
  } catch (error) {
    if (cached) return { ...cached.value, stale: true }
    return failure(route.provider, error, route.kind)
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
