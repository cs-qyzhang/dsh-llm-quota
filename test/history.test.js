import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { apply } from '../index.js'
import {
  createHistoryCollector,
  createHistoryStore,
  defaultHistoryPath,
  historyIntervalMs,
  historyPoint,
  sampleHistoryPoints,
} from '../history.js'
import { withCacheKey } from '../providers/shared.js'

const NOW = Date.parse('2026-11-10T08:00:00.000Z')
const DAY = 86_400_000
const temporaryDirectories = new Set()

test.after(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

function quota(overrides = {}) {
  return {
    ok: true,
    provider: 'test',
    kind: 'balance',
    currency: 'CNY',
    amount: '1.00',
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  }
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-llm-quota-history-'))
  temporaryDirectories.add(directory)
  return directory
}

function historyFile(t) {
  return temporaryDirectory(t).then((directory) => join(directory, 'history.sqlite'))
}

function trackedStore(t, options) {
  const store = createHistoryStore(options)
  t.after(() => store.close())
  return store
}

test('extracts precise amounts and all supported remaining quota windows', () => {
  const balance = historyPoint(quota({ amount: '65.2768280200000000' }))
  assert.equal(balance.metrics.amount, '65.2768280200000000')
  assert.equal(balance.currency, 'CNY')

  const plan = historyPoint(quota({
    kind: 'xiaomi-mimo',
    mode: 'plan',
    amount: undefined,
    fiveHour: { remainingPercent: 75, resetAt: 'dynamic' },
    weekly: { remainingPercent: 60 },
    monthly: { remainingPercent: 50 },
    plan: {
      remainingPercent: 40,
      month: { remainingPercent: 30 },
      compensation: { remainingPercent: 20 },
    },
    chat: { remainingPercent: 10 },
    usedAmount: '2.50',
    cycleUsage: '3.50',
  }))
  assert.deepEqual(plan.metrics, {
    usedAmount: '2.50',
    cycleUsage: '3.50',
    fiveHour: 75,
    weekly: 60,
    monthly: 50,
    plan: 40,
    chat: 10,
    'plan.month': 30,
    'plan.compensation': 20,
  })
  assert.equal(historyPoint(quota({ amount: 'not-a-number' })), undefined)
  assert.equal(historyPoint({ ok: false, amount: '1' }), undefined)
})

test('uses a 30 second default history interval and accepts second-based overrides', () => {
  assert.equal(historyIntervalMs(), 30_000)
  assert.equal(historyIntervalMs(5), 5_000)
  assert.equal(historyIntervalMs(0), 1_000)
  assert.equal(historyIntervalMs(Number.NaN), 30_000)
})

test('samples large responses while preserving endpoints and metric extrema', () => {
  const points = Array.from({ length: 2000 }, (_, index) => ({
    at: new Date(NOW + index * 1000).toISOString(),
    metrics: {
      amount: String(index === 10 ? -100 : index === 1500 ? 500 : index % 100),
      fiveHour: (index * 37) % 101,
    },
  }))
  const sampled = sampleHistoryPoints(points, 100)
  assert.equal(sampleHistoryPoints(points).length, 100)
  assert.equal(sampled.length, 100)
  assert.equal(new Set(sampled).size, 100)
  assert.strictEqual(sampled[0], points[0])
  assert.strictEqual(sampled[sampled.length - 1], points[points.length - 1])
  assert.ok(sampled.some((point) => point.metrics.amount === '-100'))
  assert.ok(sampled.some((point) => point.metrics.amount === '500'))
  assert.ok(sampled.some((point) => point.metrics.fiveHour === 0))
  assert.ok(sampled.some((point) => point.metrics.fiveHour === 100))
  for (let index = 1; index < sampled.length; index += 1) {
    assert.ok(Date.parse(sampled[index].at) > Date.parse(sampled[index - 1].at))
  }
  assert.deepEqual(sampleHistoryPoints(points.slice(0, 10), 100), points.slice(0, 10))
  assert.deepEqual(sampleHistoryPoints(points, 2), [points[0], points[points.length - 1]])
})

test('persists only real changes and deduplicates again after reload', async (t) => {
  const filePath = await historyFile(t)
  const store = trackedStore(t, { filePath, now: () => NOW })
  const first = quota({
    amount: '65.2768280200000000',
    fiveHour: { remainingPercent: 75, resetAt: '2026-11-10T09:00:00.000Z' },
  })
  assert.equal(await store.record('key', first), true)
  assert.equal(await store.record('key', {
    ...first,
    updatedAt: new Date(NOW + 20_000).toISOString(),
    fiveHour: { remainingPercent: 75, resetAt: '2026-11-10T09:00:20.000Z' },
  }), false)
  assert.equal(await store.record('key', {
    ...first,
    amount: '60.00',
    updatedAt: new Date(NOW + 40_000).toISOString(),
  }), true)
  store.close()

  const reloaded = trackedStore(t, { filePath, now: () => NOW + 60_000 })
  assert.equal(await reloaded.record('key', {
    ...first,
    amount: '60.00',
    updatedAt: new Date(NOW + 60_000).toISOString(),
  }), false)
  const points = await reloaded.list('key', NOW - 1)
  assert.equal(points.length, 2)
  assert.equal(points[0].metrics.amount, '65.2768280200000000')
  assert.equal(points[1].metrics.amount, '60.00')
})

test('applies retention and point limits and returns a pre-range baseline', async (t) => {
  const filePath = await historyFile(t)
  const store = trackedStore(t, { filePath, now: () => NOW, maxPoints: 2 })
  await store.record('key', quota({ amount: '0', updatedAt: new Date(NOW - 31 * DAY).toISOString() }))
  await store.record('key', quota({ amount: '1', updatedAt: new Date(NOW - 2 * DAY).toISOString() }))
  await store.record('key', quota({ amount: '2', updatedAt: new Date(NOW - DAY).toISOString() }))
  await store.record('key', quota({ amount: '3', updatedAt: new Date(NOW).toISOString() }))
  const retained = await store.list('key', 0)
  assert.deepEqual(retained.map((point) => point.metrics.amount), ['2', '3'])

  const baselineStore = trackedStore(t, { filePath: await historyFile(t), now: () => NOW })
  await baselineStore.record('key', quota({ amount: '10', updatedAt: new Date(NOW - 2 * DAY).toISOString() }))
  await baselineStore.record('key', quota({ amount: '8', updatedAt: new Date(NOW).toISOString() }))
  const withBaseline = await baselineStore.list('key', NOW - DAY)
  assert.deepEqual(withBaseline.map((point) => point.metrics.amount), ['10', '8'])
  const baselineOnly = await baselineStore.list('key', NOW + DAY)
  assert.deepEqual(baselineOnly.map((point) => point.metrics.amount), ['8'])
  assert.deepEqual(await baselineStore.list('missing', NOW), [])
})

test('writes concurrent changes into a reloadable SQLite database', async (t) => {
  const filePath = await historyFile(t)
  const store = trackedStore(t, { filePath, now: () => NOW })
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.record('key', quota({
    amount: String(index),
    updatedAt: new Date(NOW + index * 1000).toISOString(),
  }))))
  await store.flush()
  const database = new DatabaseSync(filePath)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM history_points').get().count, 20)
  database.close()
  store.close()

  const reloaded = trackedStore(t, { filePath, now: () => NOW + 30_000 })
  assert.equal((await reloaded.list('key', 0)).length, 20)
})

test('collector covers active, override and account providers with bounded concurrency', async () => {
  const active = new Map()
  let concurrent = 0
  let maximum = 0
  const calls = []
  const ctx = {
    llm: {
      listProviders: () => [{ id: 'active-a' }, { id: 'active-b' }, { id: 'unsupported' }, { id: 'unavailable' }],
    },
    get: (name) => name === 'deepseekAccount' ? {} : undefined,
  }
  const collector = createHistoryCollector({
    ctx,
    overrides: { 'active-a': {}, override: {} },
    resolveRoute: (_ctx, provider) => {
      if (provider === 'unsupported') return undefined
      if (provider === 'unavailable') return { provider, reason: 'unavailable' }
      return { provider, cacheKey: provider }
    },
    readRoute: async (route, options) => {
      calls.push(route.provider)
      assert.deepEqual(options, { force: true })
      concurrent += 1
      maximum = Math.max(maximum, concurrent)
      active.set(route.provider, true)
      await new Promise((resolve) => setImmediate(resolve))
      concurrent -= 1
      if (route.provider === 'active-a') throw new Error('isolated failure')
    },
  })
  await collector.runOnce()
  assert.deepEqual(calls.sort(), ['active-a', 'active-b', 'deepseek-account', 'override'])
  assert.equal(active.has('unsupported'), false)
  assert.equal(active.has('unavailable'), false)
  assert.ok(maximum <= 3)
})

test('collector does not overlap rounds', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let calls = 0
  const ctx = { llm: { listProviders: () => [{ id: 'one' }] }, get: () => undefined }
  const collector = createHistoryCollector({
    ctx,
    resolveRoute: (_ctx, provider) => ({ provider }),
    readRoute: () => {
      calls += 1
      return gate
    },
  })
  const first = collector.runOnce()
  const second = collector.runOnce()
  assert.strictEqual(first, second)
  assert.equal(calls, 1)
  release()
  await Promise.all([first, second])
  assert.equal(calls, 1)
})

function createApiHarness() {
  const routes = new Map()
  const disposers = []
  const ctx = {
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => {}
        },
      },
    },
    credentials: { resolve: async () => undefined },
    llm: {
      listProviders: () => [],
      listConfigurableProviders: () => [],
    },
    loader: { entries: () => [].values() },
    fiber: { restart: async () => {} },
    inject(names, callback) {
      return callback({ ...ctx, settings: { configure: () => () => {} } })
    },
    on: () => () => {},
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    get: () => undefined,
  }
  return {
    ctx,
    routes,
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose()
    },
  }
}

test('serves persisted history without reading upstream and validates the range', async (t) => {
  const directory = await temporaryDirectory(t)
  const filePath = defaultHistoryPath({ DSH_HOME: directory })
  const custom = { kind: 'kimi', endpoint: 'https://quota.example.test/v1', keyNames: [] }
  const route = withCacheKey({ provider: 'custom', ...custom })
  const store = trackedStore(t, { filePath, now: () => NOW })
  await store.record(route.cacheKey, quota({
    provider: 'custom',
    kind: 'kimi',
    currency: undefined,
    amount: undefined,
    fiveHour: { remainingPercent: 75 },
    updatedAt: new Date().toISOString(),
  }))
  store.close()

  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = directory
  const host = createApiHarness()
  t.after(() => {
    host.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  apply(host.ctx, { history: true, providers: { custom } })
  const history = host.routes.get('/api/llm-quota/history')
  assert.ok(history)
  const response = await history.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom&days=7'))
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json()
  assert.equal(data.ok, true)
  assert.equal(data.points.length, 1)
  assert.equal(data.points[0].metrics.fiveHour, 75)
  assert.equal(data.sampled, false)
  assert.equal(data.historyDefaultRange, '1h')

  const beforeDefault = Date.now()
  const defaultResponse = await history.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom'))
  const defaultData = await defaultResponse.json()
  assert.ok(Math.abs(beforeDefault - Date.parse(defaultData.since) - 3_600_000) < 1_000)

  const empty = await history.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom&days=1'))
  assert.equal((await empty.json()).ok, true)
  for (const hours of [1, 4, 12]) {
    const before = Date.now()
    const hourly = await history.fetch(new Request(`http://127.0.0.1/api/llm-quota/history?provider=custom&hours=${hours}`))
    const hourlyData = await hourly.json()
    assert.equal(hourlyData.ok, true)
    const elapsed = before - Date.parse(hourlyData.since)
    assert.ok(Math.abs(elapsed - hours * 3_600_000) < 1_000)
  }
  const invalid = await history.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom&days=0'))
  assert.equal((await invalid.json()).reason, 'invalid-range')
  const invalidHours = await history.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom&hours=2'))
  assert.equal((await invalidHours.json()).reason, 'invalid-range')
  const ambiguous = await history.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom&hours=1&days=1'))
  assert.equal((await ambiguous.json()).reason, 'invalid-range')
})

test('uses a custom history default range and falls back for invalid direct config', async (t) => {
  const directory = await temporaryDirectory(t)
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = directory
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const providers = { custom: { kind: 'kimi', endpoint: 'https://quota.example.test/v1', keyNames: [] } }
  const host = createApiHarness()
  t.after(host.dispose)
  apply(host.ctx, { history: true, providers, historyDefaultRange: { get: () => '1d' } })
  const history = host.routes.get('/api/llm-quota/history')
  const before = Date.now()
  const data = await (await history.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom'))).json()
  assert.equal(data.historyDefaultRange, '1d')
  assert.ok(Math.abs(before - Date.parse(data.since) - DAY) < 1_000)
  const explicit = await (await history.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom&hours=4'))).json()
  assert.equal(explicit.historyDefaultRange, '1d')
  assert.ok(Math.abs(before - Date.parse(explicit.since) - 4 * 3_600_000) < 1_000)

  const fallbackHost = createApiHarness()
  t.after(fallbackHost.dispose)
  apply(fallbackHost.ctx, { history: true, providers, historyDefaultRange: 'invalid' })
  const fallback = fallbackHost.routes.get('/api/llm-quota/history')
  const fallbackData = await (await fallback.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom'))).json()
  assert.equal(fallbackData.historyDefaultRange, '1h')
  assert.ok(Math.abs(before - Date.parse(fallbackData.since) - 3_600_000) < 1_000)
})

test('history storage failure does not block a successful quota response', async (t) => {
  const directory = await temporaryDirectory(t)
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  process.env.DSH_HOME = directory
  const host = createApiHarness()
  t.after(() => {
    host.dispose()
    globalThis.fetch = previousFetch
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  globalThis.fetch = async () => new Response(JSON.stringify({
    usages: { limit_5h: { used_ratio: 0.25 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  host.ctx.credentials.resolve = async () => ({ value: 'test-key' })
  // A directory at the SQLite path makes opening fail deterministically.
  const filePath = defaultHistoryPath({ DSH_HOME: directory })
  await mkdir(filePath, { recursive: true })
  apply(host.ctx, {
    history: true,
    providers: {
      custom: { kind: 'kimi', endpoint: 'https://quota.example.test/v1', keyNames: ['KEY'] },
    },
  })

  const quotaRoute = host.routes.get('/api/llm-quota')
  const response = await quotaRoute.fetch(new Request('http://127.0.0.1/api/llm-quota?provider=custom'))
  const data = await response.json()
  assert.equal(data.ok, true)
  assert.equal(data.fiveHour.remainingPercent, 75)

  const historyRoute = host.routes.get('/api/llm-quota/history')
  const historyResponse = await historyRoute.fetch(new Request('http://127.0.0.1/api/llm-quota/history?provider=custom&days=7'))
  assert.equal((await historyResponse.json()).reason, 'history-unavailable')
})
