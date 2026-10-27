import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const GLM_RESPONSE = {
  code: 200,
  success: true,
  data: {
    level: 'pro',
    limits: [{ type: 'TOKENS_LIMIT', unit: 3, percentage: 25 }],
  },
}

const KIMI_RESPONSE = {
  usages: {
    limit_5h: { used_ratio: 0.25, reset_time: '2026-10-24T11:30:21Z' },
  },
}

const MINIMAX_RESPONSE = {
  base_resp: { status_code: 0, status_msg: 'success' },
  model_remains: [
    {
      model_name: 'MiniMax-M2.5',
      end_time: 1760018000000,
      remains_time: 1800000,
      current_interval_total_count: 1500,
      current_interval_usage_count: 1245,
      current_interval_remaining_percent: 83,
      weekly_end_time: 1760604800000,
      weekly_remains_time: 604800000,
      current_weekly_total_count: 10000,
      current_weekly_usage_count: 8000,
      current_weekly_remaining_percent: 80,
    },
    {
      model_name: 'MiniMax-Hailuo-2.3',
      end_time: 1760018000000,
      current_interval_total_count: 20,
      current_interval_usage_count: 0,
      current_weekly_total_count: 20,
      current_weekly_usage_count: 0,
    },
  ],
}

function createHarness(options = {}) {
  const state = {
    providers: options.providers ?? {},
    activeProviders: options.activeProviders ?? Object.keys(options.providers ?? {}),
    keys: options.keys ?? {},
    account: options.account,
    resolvedNames: [],
    deepseek: {
      apiKeyEnv: options.deepseek?.apiKeyEnv ?? 'DEEPSEEK_API_KEY',
      baseURL: options.deepseek?.baseURL,
    },
  }
  const directories = Object.entries(state.providers).map(([provider, source]) => ({
    provider,
    displayName: provider,
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', provider],
    defaultBaseURL: source.defaultBaseURL,
    nativeAuth: { env: source.nativeEnv ?? [], oauth: source.oauth ?? false },
  }))
  const entries = [{
    options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' },
    fiber: {
      state: 2,
      config: { providers: { get: () => state.providers } },
    },
  }]

  if (options.deepseek) {
    state.activeProviders.push('deepseek-official')
    directories.push({
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
    })
    entries.push({
      options: { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek-api-key' },
      fiber: {
        state: 2,
        config: {
          apiKeyEnv: { get: () => state.deepseek.apiKeyEnv },
          baseURL: { get: () => state.deepseek.baseURL },
        },
      },
    })
  }

  let registered
  const ctx = {
    connection: {
      fetch: {
        register(route) {
          registered = route
          return async () => {}
        },
      },
    },
    credentials: {
      async resolve(name) {
        state.resolvedNames.push(name)
        const value = state.keys[name]
        if (value instanceof Error) throw value
        if (typeof value === 'function') return value()
        return typeof value === 'string' && value.length > 0 ? { value, source: 'test' } : undefined
      },
    },
    llm: {
      listProviders: () => {
        if (options.llmError) throw new Error('llm directory unavailable')
        return state.activeProviders.map((id) => ({ id, name: id }))
      },
      listConfigurableProviders: () => directories,
    },
    loader: { entries: () => entries.values() },
    effect(fn) { return fn() },
    get(name) {
      if (name === 'deepseekAccount') return state.account
      if (name === 'launchEnvironment') {
        return { get: (key) => options.launchEnvironment?.[key] }
      }
      return undefined
    },
  }

  apply(ctx, options.config)
  assert.ok(registered, 'quota route should be registered')

  return {
    state,
    route: registered,
    async request(provider, init) {
      const query = provider === undefined ? '' : `?provider=${encodeURIComponent(provider)}`
      return registered.fetch(new Request(`http://127.0.0.1/api/llm-quota${query}`, init))
    },
  }
}

function mockFetch(t, implementation) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return implementation(url, init, calls.length)
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function body(response) {
  assert.equal(response.status, 200)
  return response.json()
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('registers an authenticated API fetch route and returns no-store JSON', async (t) => {
  const host = createHarness({
    providers: {
      'kimi-coding': { defaultBaseURL: 'https://api.kimi.com/coding', nativeEnv: ['KIMI_API_KEY'] },
    },
    keys: { KIMI_API_KEY: 'test-key' },
  })
  const calls = mockFetch(t, async () => json(KIMI_RESPONSE))

  assert.equal(host.route.path, '/api/llm-quota')
  assert.deepEqual(host.route.methods, ['GET'])
  assert.equal(host.route.requestBody, 'buffered')
  const response = await host.request('kimi-coding')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('content-type'), /application\/json/)
  const data = await body(response)
  assert.equal(data.ok, true)
  assert.equal(data.fiveHour.remainingPercent, 75)
  assert.equal(calls[0].url, 'https://api.kimi.com/coding/v1/usages')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key')
})

test('uses the DSH default endpoints for Z.AI and zai-coding-cn', async (t) => {
  const host = createHarness({
    providers: {
      'zai-coding-cn': {
        defaultBaseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
        nativeEnv: ['ZAI_CODING_CN_API_KEY'],
      },
      zai: {
        defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4',
        nativeEnv: ['ZAI_API_KEY'],
      },
    },
    keys: { ZAI_CODING_CN_API_KEY: 'cn-key', ZAI_API_KEY: 'global-key' },
  })
  const calls = mockFetch(t, async () => json(GLM_RESPONSE))

  await host.request('zai-coding-cn')
  await host.request('zai')
  assert.deepEqual(calls.map((call) => call.url), [
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/monitor/usage/quota/limit',
  ])
})

test('follows live baseURL changes without reusing the old route cache', async (t) => {
  const host = createHarness({
    providers: {
      'zai-coding-cn': {
        apiKeyEnv: 'ZAI_CODING_CN_API_KEY',
        baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
        defaultBaseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
        nativeEnv: ['ZAI_API_KEY'],
      },
    },
    keys: { ZAI_CODING_CN_API_KEY: 'cn-key' },
  })
  const calls = mockFetch(t, async () => json(GLM_RESPONSE))

  await host.request('zai-coding-cn')
  host.state.providers['zai-coding-cn'].baseURL = 'https://api.z.ai/api/coding/paas/v4'
  await host.request('zai-coding-cn')

  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://open.bigmodel.cn/api/monitor/usage/quota/limit')
  assert.equal(calls[1].url, 'https://api.z.ai/api/monitor/usage/quota/limit')
})

test('prefers explicit apiKeyEnv and follows live credential reference changes', async (t) => {
  const host = createHarness({
    providers: {
      'kimi-coding': {
        apiKeyEnv: 'FIRST_KEY',
        defaultBaseURL: 'https://api.kimi.com/coding',
        nativeEnv: ['NATIVE_KEY'],
      },
    },
    keys: { FIRST_KEY: 'first', NATIVE_KEY: 'native', SECOND_KEY: 'second' },
  })
  const calls = mockFetch(t, async () => json(KIMI_RESPONSE))

  await host.request('kimi-coding')
  host.state.providers['kimi-coding'].apiKeyEnv = 'SECOND_KEY'
  await host.request('kimi-coding')

  assert.equal(calls.length, 2)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer first')
  assert.equal(calls[1].init.headers.Authorization, 'Bearer second')
})

test('reads current-profile style ZAI and Kimi credential references', async (t) => {
  const host = createHarness({
    providers: {
      'zai-coding-cn': {
        apiKeyEnv: 'ZAI_CODING_CN_API_KEY',
        defaultBaseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
      },
      'kimi-coding': {
        apiKeyEnv: 'KIMI_CODING_API_KEY',
        defaultBaseURL: 'https://api.kimi.com/coding',
      },
    },
    keys: { ZAI_CODING_CN_API_KEY: 'zai-current', KIMI_CODING_API_KEY: 'kimi-current' },
  })
  const calls = mockFetch(t, async (url) => json(String(url).includes('kimi') ? KIMI_RESPONSE : GLM_RESPONSE))

  await host.request('zai-coding-cn')
  await host.request('kimi-coding')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer zai-current')
  assert.equal(calls[1].init.headers.Authorization, 'Bearer kimi-current')
})

test('resolves deepseek-official live credentials and launch-environment baseURL', async (t) => {
  const host = createHarness({
    deepseek: { apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY' },
    launchEnvironment: {
      DEEPSEEK_BASE_URL: { value: 'https://api.deepseek.com/anthropic', source: 'process' },
    },
    keys: { CUSTOM_DEEPSEEK_KEY: 'deepseek-key' },
  })
  const calls = mockFetch(t, async () => json({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '10.00' }],
  }))

  const data = await body(await host.request('deepseek-official'))
  assert.equal(data.ok, true)
  assert.equal(data.amount, '10.00')
  assert.equal(calls[0].url, 'https://api.deepseek.com/user/balance')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer deepseek-key')

  host.state.deepseek.baseURL = 'https://proxy.example.test/anthropic'
  const unsupported = await body(await host.request('deepseek-official'))
  assert.equal(unsupported.reason, 'unsupported')
  assert.equal(calls.length, 1)
})

test('does not call upstream for unsupported, inactive, unknown, or OAuth-only routes', async (t) => {
  const host = createHarness({
    providers: {
      openai: {
        defaultBaseURL: 'https://api.openai.com/v1',
        nativeEnv: ['OPENAI_API_KEY'],
      },
      'proxy-kimi': {
        baseURL: 'https://proxy.example.test/coding',
        defaultBaseURL: 'https://api.kimi.com/coding',
        nativeEnv: ['KIMI_API_KEY'],
      },
      'oauth-kimi': {
        defaultBaseURL: 'https://api.kimi.com/coding',
        nativeEnv: [],
        oauth: true,
      },
      inactive: {
        defaultBaseURL: 'https://api.kimi.com/coding',
        nativeEnv: ['KIMI_API_KEY'],
      },
    },
    activeProviders: ['openai', 'proxy-kimi', 'oauth-kimi'],
    keys: { OPENAI_API_KEY: 'openai', KIMI_API_KEY: 'kimi' },
  })
  const calls = mockFetch(t, async () => json(KIMI_RESPONSE))

  for (const provider of ['openai', 'proxy-kimi', 'oauth-kimi', 'inactive', 'kimi-forged-alias']) {
    const data = await body(await host.request(provider))
    assert.equal(data.ok, false, provider)
    // openai resolves to the usage adapter but reports the missing admin key;
    // everything else stays unsupported without touching upstream.
    assert.equal(data.reason, provider === 'openai' ? 'missing-credential' : 'unsupported', provider)
  }
  assert.equal(calls.length, 0)
})

test('supports explicit provider overrides without an active DSH route', async (t) => {
  const host = createHarness({
    config: {
      providers: {
        'custom-kimi': {
          kind: 'kimi',
          endpoint: 'https://quota.example.test/v1/usages',
          keyNames: ['CUSTOM_KIMI_KEY'],
        },
      },
    },
    keys: { CUSTOM_KIMI_KEY: 'custom-key' },
  })
  const calls = mockFetch(t, async () => json(KIMI_RESPONSE))

  const data = await body(await host.request('custom-kimi'))
  assert.equal(data.ok, true)
  assert.equal(data.provider, 'custom-kimi')
  assert.equal(calls[0].url, 'https://quota.example.test/v1/usages')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer custom-key')
})

test('keeps GLM windows distinct and handles weekly-only and fallback limits', async (t) => {
  const host = createHarness({
    providers: {
      zai: { defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4', nativeEnv: ['ZAI_API_KEY'] },
      bigmodel: { defaultBaseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', nativeEnv: ['ZAI_API_KEY'] },
      'custom-glm': { defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4', nativeEnv: ['ZAI_API_KEY'] },
    },
    keys: { ZAI_API_KEY: 'glm-key' },
  })
  mockFetch(t, async (_url, _init, count) => {
    if (count === 1) {
      return json({ code: 200, data: { limits: [{ type: 'TOKENS_LIMIT', unit: 6, percentage: 40 }] } })
    }
    if (count === 2) {
      return json({ code: 200, data: { limits: [
        { type: 'TOKENS_LIMIT', unit: 3, percentage: 25 },
        { type: 'TOKENS_LIMIT', unit: 6, percentage: 50 },
      ] } })
    }
    return json({ code: 200, data: { limits: [
      { type: 'TOKENS_LIMIT', unit: 9, percentage: 10 },
      { type: 'TOKENS_LIMIT', unit: 10, percentage: 20 },
    ] } })
  })

  const weeklyOnly = await body(await host.request('zai'))
  assert.equal(weeklyOnly.fiveHour, undefined)
  assert.equal(weeklyOnly.weekly.remainingPercent, 60)

  const both = await body(await host.request('bigmodel'))
  assert.equal(both.fiveHour.remainingPercent, 75)
  assert.equal(both.weekly.remainingPercent, 50)

  const fallback = await body(await host.request('custom-glm'))
  assert.equal(fallback.fiveHour.remainingPercent, 90)
  assert.equal(fallback.weekly.remainingPercent, 80)
})

test('treats empty GLM and Kimi payloads as failures and preserves stale success', async (t) => {
  const host = createHarness({
    providers: {
      'kimi-coding': { defaultBaseURL: 'https://api.kimi.com/coding', nativeEnv: ['KIMI_API_KEY'] },
      zai: { defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4', nativeEnv: ['ZAI_API_KEY'] },
    },
    keys: { KIMI_API_KEY: 'kimi-key', ZAI_API_KEY: 'zai-key' },
    config: { cacheSeconds: 0 },
  })
  mockFetch(t, async (_url, _init, count) => {
    if (count === 1) return json(KIMI_RESPONSE)
    if (count === 2) return json({})
    if (count === 3) return json({})
    return json(GLM_RESPONSE)
  })

  await host.request('kimi-coding')
  const staleKimi = await body(await host.request('kimi-coding'))
  assert.equal(staleKimi.stale, true)
  assert.equal(staleKimi.fiveHour.remainingPercent, 75)

  const emptyGlm = await body(await host.request('zai'))
  assert.equal(emptyGlm.ok, false)
  assert.equal(emptyGlm.reason, 'error')
})

test('returns the last account balance as stale after a structured DSH failure', async () => {
  let reads = 0
  const host = createHarness({
    account: {
      async getState() { return { status: 'credential-stored' } },
      async getBalance() {
        reads += 1
        return reads === 1 ? {
          status: 'ready',
          value: [{ currency: 'CNY', balance: '12.00' }],
          bonusWallets: [],
        } : { status: 'failed' }
      },
    },
    config: { cacheSeconds: 0 },
  })

  const first = await body(await host.request('deepseek-account'))
  assert.equal(first.amount, '12.00')
  const second = await body(await host.request('deepseek-account'))
  assert.equal(second.ok, true)
  assert.equal(second.amount, '12.00')
  assert.equal(second.stale, true)
})

test('terminal states replace success and are not cached', async (t) => {
  let signedOut = false
  const accountHost = createHarness({
    account: {
      async getState() { return { status: signedOut ? 'signed-out' : 'credential-stored' } },
      async getBalance() {
        return {
          status: 'ready',
          value: [{ currency: 'CNY', balance: '12.00' }],
          bonusWallets: [],
        }
      },
    },
    config: { cacheSeconds: 0 },
  })
  await accountHost.request('deepseek-account')
  signedOut = true
  const signedOutData = await body(await accountHost.request('deepseek-account'))
  assert.equal(signedOutData.reason, 'signed-out')
  assert.equal(signedOutData.stale, undefined)

  const keyHost = createHarness({
    providers: {
      'kimi-coding': { defaultBaseURL: 'https://api.kimi.com/coding', nativeEnv: ['KIMI_API_KEY'] },
    },
    keys: { KIMI_API_KEY: 'kimi-key' },
    config: { cacheSeconds: 0 },
  })
  mockFetch(t, async () => json(KIMI_RESPONSE))
  await keyHost.request('kimi-coding')
  delete keyHost.state.keys.KIMI_API_KEY
  const missing = await body(await keyHost.request('kimi-coding'))
  assert.equal(missing.reason, 'missing-credential')
  assert.equal(missing.stale, undefined)
})

test('deduplicates concurrent loads and cleans pending after failure', async (t) => {
  const host = createHarness({
    providers: {
      'kimi-coding': {
        baseURL: 'https://api.kimi.com/coding',
        defaultBaseURL: 'https://api.kimi.com/coding',
        nativeEnv: ['KIMI_API_KEY'],
      },
    },
    keys: { KIMI_API_KEY: 'kimi-key' },
    config: { cacheSeconds: 0 },
  })
  const gate = deferred()
  let failNext = false
  const calls = mockFetch(t, async () => {
    if (failNext) throw new Error('temporary failure')
    await gate.promise
    return json(KIMI_RESPONSE)
  })

  const first = host.request('kimi-coding')
  const second = host.request('kimi-coding')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 1)
  gate.resolve()
  await Promise.all([first, second])

  failNext = true
  const failed = await body(await host.request('kimi-coding'))
  assert.equal(failed.stale, true)
  failNext = false
  const recovered = await body(await host.request('kimi-coding'))
  assert.equal(recovered.ok, true)
  assert.equal(calls.length, 3)
})

test('bounds successful cache entries with LRU eviction', async (t) => {
  const providers = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [
    `custom-${index + 1}`,
    { kind: 'kimi', endpoint: 'https://quota.example.test/v1', keyNames: ['CUSTOM_KEY'] },
  ]))
  const host = createHarness({
    config: { providers },
    keys: { CUSTOM_KEY: 'custom-key' },
  })
  const calls = mockFetch(t, async () => json(KIMI_RESPONSE))

  for (let index = 1; index <= 51; index += 1) await host.request(`custom-${index}`)
  assert.equal(calls.length, 51)
  await host.request('custom-2')
  assert.equal(calls.length, 51, 'a recent entry should remain cached')
  await host.request('custom-1')
  assert.equal(calls.length, 52, 'the oldest entry should have been evicted')
})

test('surfaces credential service failures without exposing secret values', async (t) => {
  const host = createHarness({
    providers: {
      'kimi-coding': { defaultBaseURL: 'https://api.kimi.com/coding', nativeEnv: ['KIMI_API_KEY'] },
    },
    keys: { KIMI_API_KEY: new Error('credential store unavailable') },
  })
  const calls = mockFetch(t, async () => json(KIMI_RESPONSE))

  const response = await host.request('kimi-coding')
  const text = await response.text()
  const data = JSON.parse(text)
  assert.equal(data.ok, false)
  assert.equal(data.reason, 'error')
  assert.match(data.error, /credential store unavailable/)
  assert.equal(calls.length, 0)
  assert.equal(text.includes('test-secret'), false)
})

test('returns a structured error when route resolution throws', async (t) => {
  const host = createHarness({
    providers: {
      'kimi-coding': { defaultBaseURL: 'https://api.kimi.com/coding', nativeEnv: ['KIMI_API_KEY'] },
    },
    keys: { KIMI_API_KEY: 'kimi-key' },
    llmError: true,
  })
  const calls = mockFetch(t, async () => json(KIMI_RESPONSE))

  const response = await host.request('kimi-coding')
  assert.equal(response.status, 200)
  const data = await body(response)
  assert.equal(data.ok, false)
  assert.equal(data.reason, 'error')
  assert.match(data.error, /llm directory unavailable/)
  assert.equal(calls.length, 0)
})

test('cuts off a hanging account service at the deadline and releases pending', async (t) => {
  let hang = true
  const host = createHarness({
    account: {
      async getState() { return { status: 'credential-stored' } },
      async getBalance() {
        if (hang) return new Promise(() => {})
        return {
          status: 'ready',
          value: [{ currency: 'CNY', balance: '12.00' }],
          bonusWallets: [],
        }
      },
    },
    config: { cacheSeconds: 0 },
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const request = host.request('deepseek-account')
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(5000)
  const timedOut = await body(await request)
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.reason, 'error')

  hang = false
  const recovered = await body(await host.request('deepseek-account'))
  assert.equal(recovered.ok, true)
  assert.equal(recovered.amount, '12.00')
})

test('returns the last successful balance as stale after a timeout', async (t) => {
  let hang = false
  const host = createHarness({
    account: {
      async getState() { return { status: 'credential-stored' } },
      async getBalance() {
        if (hang) return new Promise(() => {})
        return {
          status: 'ready',
          value: [{ currency: 'CNY', balance: '12.00' }],
          bonusWallets: [],
        }
      },
    },
    config: { cacheSeconds: 0 },
  })

  await host.request('deepseek-account')
  hang = true
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const request = host.request('deepseek-account')
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(5000)

  const stale = await body(await request)
  assert.equal(stale.ok, true)
  assert.equal(stale.amount, '12.00')
  assert.equal(stale.stale, true)
})

test('normalizes numeric wallet balances', async (t) => {
  const host = createHarness({
    account: {
      async getState() { return { status: 'credential-stored' } },
      async getBalance() {
        return {
          status: 'ready',
          value: [{ currency: 'CNY', balance: 12.5 }],
          bonusWallets: [{ currency: 'CNY', balance: 0 }],
        }
      },
    },
  })

  const account = await body(await host.request('deepseek-account'))
  assert.equal(account.amount, '12.5')
  assert.equal(account.wallets[0].balance, '12.5')
  assert.equal(account.bonusWallets[0].balance, '0')

  const deepseekHost = createHarness({
    deepseek: { apiKeyEnv: 'NUMERIC_DEEPSEEK_KEY' },
    keys: { NUMERIC_DEEPSEEK_KEY: 'deepseek-key' },
  })
  mockFetch(t, async () => json({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: 3.5 }],
  }))

  const balance = await body(await deepseekHost.request('deepseek-official'))
  assert.equal(balance.amount, '3.5')
  assert.equal(balance.wallets[0].balance, '3.5')
})

test('accepts numeric-string GLM business codes', async (t) => {
  const host = createHarness({
    providers: {
      zai: { defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4', nativeEnv: ['ZAI_API_KEY'] },
    },
    keys: { ZAI_API_KEY: 'zai-key' },
  })
  mockFetch(t, async () => json({
    code: '200',
    data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, percentage: 25 }] },
  }))

  const data = await body(await host.request('zai'))
  assert.equal(data.ok, true)
  assert.equal(data.fiveHour.remainingPercent, 75)
})

test('reads MiniMax Coding Plan remaining prompts for both regions', async (t) => {
  const host = createHarness({
    providers: {
      minimax: {
        defaultBaseURL: 'https://api.minimax.io/anthropic',
        nativeEnv: ['MINIMAX_API_KEY'],
      },
      'minimax-cn': {
        defaultBaseURL: 'https://api.minimaxi.com/anthropic',
        nativeEnv: ['MINIMAX_CN_API_KEY'],
      },
    },
    keys: { MINIMAX_API_KEY: 'global-key', MINIMAX_CN_API_KEY: 'cn-key' },
  })
  const calls = mockFetch(t, async () => json(MINIMAX_RESPONSE))

  const global = await body(await host.request('minimax'))
  const china = await body(await host.request('minimax-cn'))

  assert.equal(calls[0].url, 'https://api.minimax.io/v1/token_plan/remains')
  assert.equal(calls[1].url, 'https://api.minimaxi.com/v1/token_plan/remains')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer global-key')
  assert.equal(calls[1].init.headers.Authorization, 'Bearer cn-key')

  for (const data of [global, china]) {
    assert.equal(data.ok, true)
    assert.equal(data.kind, 'minimax')
    assert.equal(data.model, 'MiniMax-M2.5')
    assert.equal(data.fiveHour.usedPercent, 17)
    assert.equal(data.fiveHour.remainingPercent, 83)
    assert.equal(data.fiveHour.resetAt, '2025-10-09T13:53:20.000Z')
    assert.equal(data.weekly.usedPercent, 20)
    assert.equal(data.weekly.remainingPercent, 80)
    assert.equal(data.weekly.resetAt, '2025-10-16T08:53:20.000Z')
  }
})

test('derives MiniMax windows from counts when server percentages are absent', async (t) => {
  const host = createHarness({
    providers: {
      'minimax-cn': {
        defaultBaseURL: 'https://api.minimaxi.com/anthropic',
        nativeEnv: ['MINIMAX_CN_API_KEY'],
      },
    },
    keys: { MINIMAX_CN_API_KEY: 'cn-key' },
  })
  mockFetch(t, async () => json({
    model_remains: [{
      model_name: 'MiniMax-M2.5',
      current_interval_total_count: '1500',
      current_interval_usage_count: '1245',
      current_interval_remaining_percent: null,
      current_weekly_total_count: 10000,
      current_weekly_usage_count: 8000,
    }],
  }))

  const data = await body(await host.request('minimax-cn'))
  assert.equal(data.fiveHour.usedPercent, 17)
  assert.equal(data.fiveHour.remainingPercent, 83)
  assert.equal(data.weekly.usedPercent, 20)
  assert.equal(data.fiveHour.resetAt, undefined)
})

test('falls back to the legacy MiniMax Coding Plan endpoint on business errors', async (t) => {
  const host = createHarness({
    providers: {
      'minimax-cn': {
        defaultBaseURL: 'https://api.minimaxi.com/anthropic',
        nativeEnv: ['MINIMAX_CN_API_KEY'],
      },
    },
    keys: { MINIMAX_CN_API_KEY: 'cn-key' },
  })
  const calls = mockFetch(t, async (_url, _init, count) => (
    count === 1
      ? json({ base_resp: { status_code: 2013, status_msg: 'invalid params' } })
      : json(MINIMAX_RESPONSE)
  ))

  const data = await body(await host.request('minimax-cn'))
  assert.equal(data.ok, true)
  assert.deepEqual(calls.map((call) => call.url), [
    'https://api.minimaxi.com/v1/token_plan/remains',
    'https://api.minimaxi.com/v1/coding_plan/remains',
  ])
})

test('reports a missing MiniMax key without calling upstream', async (t) => {
  const host = createHarness({
    providers: {
      minimax: {
        defaultBaseURL: 'https://api.minimax.io/anthropic',
        nativeEnv: ['MINIMAX_API_KEY'],
      },
    },
    keys: {},
  })
  const calls = mockFetch(t, async () => json(MINIMAX_RESPONSE))

  const data = await body(await host.request('minimax'))
  assert.equal(data.ok, false)
  assert.equal(data.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('reads OpenRouter credits as a USD balance', async (t) => {
  const host = createHarness({
    providers: {
      openrouter: {
        defaultBaseURL: 'https://openrouter.ai/api/v1',
        nativeEnv: ['OPENROUTER_API_KEY'],
      },
    },
    keys: { OPENROUTER_API_KEY: 'or-key' },
  })
  const calls = mockFetch(t, async () => json({
    data: { total_credits: 20, total_usage: 4.5 },
  }))

  const data = await body(await host.request('openrouter'))
  assert.equal(data.ok, true)
  assert.equal(data.kind, 'openrouter')
  assert.equal(data.currency, 'USD')
  assert.equal(data.amount, '15.5')
  assert.equal(data.totalCredits, '20')
  assert.equal(data.totalUsage, '4.5')
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/credits')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer or-key')
})

test('reports a missing OpenRouter key and rejects invalid payloads', async (t) => {
  const missing = createHarness({
    providers: {
      openrouter: {
        defaultBaseURL: 'https://openrouter.ai/api/v1',
        nativeEnv: ['OPENROUTER_API_KEY'],
      },
    },
    keys: {},
  })
  let calls = mockFetch(t, async () => json({ data: {} }))
  const missingData = await body(await missing.request('openrouter'))
  assert.equal(missingData.reason, 'missing-credential')
  assert.equal(calls.length, 0)

  const invalid = createHarness({
    providers: {
      openrouter: {
        defaultBaseURL: 'https://openrouter.ai/api/v1',
        nativeEnv: ['OPENROUTER_API_KEY'],
      },
    },
    keys: { OPENROUTER_API_KEY: 'or-key' },
  })
  calls = mockFetch(t, async () => json({ data: {} }))
  const invalidData = await body(await invalid.request('openrouter'))
  assert.equal(invalidData.ok, false)
  assert.equal(invalidData.reason, 'error')
  assert.match(invalidData.error, /invalid quota response/)
})

test('reads Vercel AI Gateway credits as a USD balance', async (t) => {
  const host = createHarness({
    providers: {
      vercel: {
        defaultBaseURL: 'https://ai-gateway.vercel.sh/v1',
        nativeEnv: ['AI_GATEWAY_API_KEY'],
      },
    },
    keys: { AI_GATEWAY_API_KEY: 'gateway-key' },
  })
  const calls = mockFetch(t, async () => json({ balance: '95.50', total_used: '4.50' }))

  const data = await body(await host.request('vercel'))
  assert.equal(data.ok, true)
  assert.equal(data.kind, 'vercel-gateway')
  assert.equal(data.currency, 'USD')
  assert.equal(data.amount, '95.50')
  assert.equal(data.totalUsage, '4.50')
  assert.equal(calls[0].url, 'https://ai-gateway.vercel.sh/v1/credits')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gateway-key')
})

test('reports a missing Vercel AI Gateway key and rejects invalid payloads', async (t) => {
  const providers = {
    vercel: {
      defaultBaseURL: 'https://ai-gateway.vercel.sh/v1',
      nativeEnv: ['AI_GATEWAY_API_KEY'],
    },
  }
  const missing = createHarness({ providers, keys: {} })
  let calls = mockFetch(t, async () => json({ balance: '95.50' }))
  const missingData = await body(await missing.request('vercel'))
  assert.equal(missingData.reason, 'missing-credential')
  assert.equal(calls.length, 0)

  const invalid = createHarness({ providers, keys: { AI_GATEWAY_API_KEY: 'gateway-key' } })
  calls = mockFetch(t, async () => json({}))
  const invalidData = await body(await invalid.request('vercel'))
  assert.equal(invalidData.ok, false)
  assert.equal(invalidData.reason, 'error')
  assert.match(invalidData.error, /invalid quota response/)
})

test('reads only the billing mode that matches the MiMo provider', async (t) => {
  const host = createHarness({
    providers: {
      xiaomi: {
        defaultBaseURL: 'https://api.xiaomimimo.com/v1',
        nativeEnv: ['XIAOMI_API_KEY'],
      },
      'xiaomi-token-plan-cn': {
        defaultBaseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
        nativeEnv: ['XIAOMI_TOKEN_PLAN_CN_API_KEY'],
      },
      'xiaomi-token-plan-sgp': {
        defaultBaseURL: 'https://token-plan-sgp.xiaomimimo.com/v1',
        nativeEnv: ['XIAOMI_TOKEN_PLAN_SGP_API_KEY'],
      },
    },
    keys: {
      MIMO_COOKIE: 'serviceToken=secret-token; userId=42',
      XIAOMI_API_KEY: 'sk-inference',
      XIAOMI_TOKEN_PLAN_CN_API_KEY: 'tp-plan',
      XIAOMI_TOKEN_PLAN_SGP_API_KEY: 'tp-plan-sgp',
    },
  })
  const calls = mockFetch(t, async (url) => {
    const target = String(url)
    if (target.endsWith('/balance')) {
      return json({
        code: 0,
        data: { balance: '12.34', cashBalance: '10.00', giftBalance: '2.34', frozenBalance: '0' },
      })
    }
    if (target.endsWith('/tokenPlan/usage')) {
      return json({
        code: 0,
        data: {
          usage: {
            items: [{ name: 'plan_total_token', used: 25, limit: 100, percent: 0.25 }],
          },
          monthUsage: {
            items: [{ name: 'month_total_token', used: 5, limit: 50, percent: 0.1 }],
          },
        },
      })
    }
    if (target.endsWith('/tokenPlan/detail')) {
      return json({
        code: 0,
        data: { planName: 'Lite', currentPeriodEnd: '2026-11-01T00:00:00Z' },
      })
    }
    if (target.endsWith('/userProfile')) return json({ code: 0, data: { idc: 310 } })
    return json({ code: 404 }, 404)
  })

  const balance = await body(await host.request('xiaomi'))
  assert.equal(balance.ok, true)
  assert.equal(balance.kind, 'xiaomi-mimo')
  assert.equal(balance.mode, 'balance')
  assert.equal(balance.currency, 'CNY')
  assert.equal(balance.amount, '12.34')
  assert.equal(balance.cashBalance, '10.00')
  assert.equal(balance.giftBalance, '2.34')
  assert.equal(balance.plan, undefined)

  assert.deepEqual(calls.map((call) => call.url), [
    'https://platform.xiaomimimo.com/api/v1/balance',
    'https://platform.xiaomimimo.com/api/v1/userProfile',
  ])

  for (const provider of ['xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp']) {
    const data = await body(await host.request(provider))
    assert.equal(data.ok, true, provider)
    assert.equal(data.kind, 'xiaomi-mimo', provider)
    assert.equal(data.mode, 'plan', provider)
    assert.equal(data.amount, undefined, provider)
    assert.equal(data.cashBalance, undefined, provider)
    assert.equal(data.plan.usedPercent, 25, provider)
    assert.equal(data.plan.remainingPercent, 75, provider)
    assert.equal(data.plan.used, 25, provider)
    assert.equal(data.plan.limit, 100, provider)
    assert.equal(data.plan.resetAt, '2026-11-01T00:00:00.000Z', provider)
    assert.equal(data.plan.month.usedPercent, 10, provider)
  }

  assert.deepEqual(calls.slice(2).map((call) => call.url), [
    'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage',
    'https://platform.xiaomimimo.com/api/v1/tokenPlan/detail',
    'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage',
    'https://platform.xiaomimimo.com/api/v1/tokenPlan/detail',
  ])
  for (const call of calls) {
    assert.match(call.url, /^https:\/\/platform\.xiaomimimo\.com\/api\/v1\//)
    assert.equal(call.init.headers.Cookie, 'serviceToken=secret-token; userId=42')
    assert.ok(call.init.headers['x-timezone'])
  }
})

test('reports a missing MiMo console cookie without calling upstream', async (t) => {
  const host = createHarness({
    providers: {
      xiaomi: {
        defaultBaseURL: 'https://api.xiaomimimo.com/v1',
        nativeEnv: ['XIAOMI_API_KEY'],
      },
    },
    keys: { XIAOMI_API_KEY: 'sk-inference' },
  })
  const calls = mockFetch(t, async () => json({}))

  const data = await body(await host.request('xiaomi'))
  assert.equal(data.ok, false)
  assert.equal(data.reason, 'missing-cookie')
  assert.equal(calls.length, 0)
})

test('reads MiMo pay-as-you-go balance without requesting Token Plan', async (t) => {
  const host = createHarness({
    providers: {
      xiaomi: {
        defaultBaseURL: 'https://api.xiaomimimo.com/v1',
        nativeEnv: ['XIAOMI_API_KEY'],
      },
    },
    keys: { MIMO_COOKIE: 'userId=42' },
  })
  const calls = mockFetch(t, async (url) => {
    const target = String(url)
    if (target.endsWith('/balance')) {
      return json({ code: 0, data: { balance: '8.00', cashBalance: '8.00' } })
    }
    if (target.endsWith('/userProfile')) return json({ code: 0, data: { idc: 315 } })
    return json({ code: 401, message: 'login required' })
  })

  const data = await body(await host.request('xiaomi'))
  assert.equal(data.ok, true)
  assert.equal(data.mode, 'balance')
  assert.equal(data.amount, '8.00')
  assert.equal(data.currency, 'USD')
  assert.equal(data.plan, undefined)
  assert.deepEqual(calls.map((call) => call.url), [
    'https://platform.xiaomimimo.com/api/v1/balance',
    'https://platform.xiaomimimo.com/api/v1/userProfile',
  ])
})

test('treats a rejected MiMo console cookie as a temporary error', async (t) => {
  const host = createHarness({
    providers: {
      xiaomi: {
        defaultBaseURL: 'https://api.xiaomimimo.com/v1',
        nativeEnv: ['XIAOMI_API_KEY'],
      },
    },
    keys: { MIMO_COOKIE: 'serviceToken=expired; userId=42' },
  })
  const calls = mockFetch(t, async () => json({ code: 401, message: 'login required' }, 401))

  const data = await body(await host.request('xiaomi'))
  assert.equal(data.ok, false)
  assert.equal(data.reason, 'error')
  assert.match(data.error, /HTTP 401/)
  assert.equal(calls.length, 2)
})

test('reads the Moonshot pay-as-you-go balance for both regions', async (t) => {
  const host = createHarness({
    providers: {
      'moonshotai-cn': {
        defaultBaseURL: 'https://api.moonshot.cn/v1',
        nativeEnv: ['MOONSHOT_API_KEY'],
      },
      moonshotai: {
        defaultBaseURL: 'https://api.moonshot.ai/v1',
        nativeEnv: ['MOONSHOT_API_KEY'],
      },
    },
    keys: { MOONSHOT_API_KEY: 'ms-key' },
  })
  const calls = mockFetch(t, async () => json({
    code: 0,
    data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
    scode: '0x0',
    status: true,
  }))

  const cn = await body(await host.request('moonshotai-cn'))
  assert.equal(cn.ok, true)
  assert.equal(cn.kind, 'balance')
  assert.equal(cn.service, 'moonshot')
  assert.equal(cn.currency, 'CNY')
  assert.equal(cn.amount, '49.58894')
  assert.equal(cn.wallets[0].balance, '3.00001')
  assert.equal(cn.bonusWallets[0].balance, '46.58893')
  assert.equal(cn.available, true)

  const global = await body(await host.request('moonshotai'))
  assert.equal(global.ok, true)
  assert.equal(global.currency, 'USD')

  assert.deepEqual(calls.map((call) => call.url), [
    'https://api.moonshot.cn/v1/users/me/balance',
    'https://api.moonshot.ai/v1/users/me/balance',
  ])
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ms-key')
})

test('reports a missing Moonshot key and rejects invalid payloads', async (t) => {
  const missing = createHarness({
    providers: {
      'moonshotai-cn': {
        defaultBaseURL: 'https://api.moonshot.cn/v1',
        nativeEnv: ['MOONSHOT_API_KEY'],
      },
    },
    keys: {},
  })
  let calls = mockFetch(t, async () => json({ code: 0, data: {} }))
  const missingData = await body(await missing.request('moonshotai-cn'))
  assert.equal(missingData.ok, false)
  assert.equal(missingData.reason, 'missing-credential')
  assert.equal(calls.length, 0)

  const invalid = createHarness({
    providers: {
      'moonshotai-cn': {
        defaultBaseURL: 'https://api.moonshot.cn/v1',
        nativeEnv: ['MOONSHOT_API_KEY'],
      },
    },
    keys: { MOONSHOT_API_KEY: 'ms-key' },
  })
  calls = mockFetch(t, async () => json({ code: 0, data: {} }))
  const invalidData = await body(await invalid.request('moonshotai-cn'))
  assert.equal(invalidData.ok, false)
  assert.equal(invalidData.reason, 'error')
  assert.match(invalidData.error, /invalid quota response/)
})

test('reads Qwen Token Plan usage through the console gateway', async (t) => {
  const host = createHarness({
    providers: {
      'qwen-token-plan-cn': {
        defaultBaseURL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        nativeEnv: ['QWEN_TOKEN_PLAN_CN_API_KEY'],
      },
      'qwen-token-plan': {
        defaultBaseURL: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
        nativeEnv: ['QWEN_TOKEN_PLAN_API_KEY'],
      },
    },
    keys: { QWEN_CONSOLE_TOKEN: 'console-token' },
  })
  const calls = mockFetch(t, async () => json({
    data: {
      DataV2: {
        data: {
          data: { per1MonthPercentage: 0.5, per1MonthResetTime: 1_786_000_000_000 },
        },
      },
    },
  }))

  const cn = await body(await host.request('qwen-token-plan-cn'))
  assert.equal(cn.ok, true)
  assert.equal(cn.kind, 'qwen')
  assert.equal(cn.plan.usedPercent, 50)
  assert.equal(cn.plan.remainingPercent, 50)
  assert.equal(cn.plan.resetAt, new Date(1_786_000_000_000).toISOString())

  const singapore = await body(await host.request('qwen-token-plan'))
  assert.equal(singapore.ok, true)
  assert.equal(singapore.plan.remainingPercent, 50)

  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer console-token')
  assert.match(calls[0].url, /^https:\/\/bailian-cs\.console\.aliyun\.com\/cli\/api\.json\?/)
  assert.match(calls[0].url, /action=BroadScopeAspnGateway/)
  const cnBody = new URLSearchParams(calls[0].init.body)
  assert.equal(cnBody.get('region'), 'cn-beijing')
  assert.match(cnBody.get('params'), /tokenplan\/personal\/api\/v2\/usage/)

  assert.match(calls[1].url, /^https:\/\/bailian-singapore-cs\.alibabacloud\.com\/cli\/api\.json\?/)
  assert.match(calls[1].url, /action=IntlBroadScopeAspnGateway/)
  assert.equal(new URLSearchParams(calls[1].init.body).get('region'), 'ap-southeast-1')
})

test('reports a missing Qwen console token without calling upstream', async (t) => {
  const host = createHarness({
    providers: {
      'qwen-token-plan-cn': {
        defaultBaseURL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        nativeEnv: ['QWEN_TOKEN_PLAN_CN_API_KEY'],
      },
    },
    keys: { QWEN_TOKEN_PLAN_CN_API_KEY: 'sk-sp-plan' },
  })
  const calls = mockFetch(t, async () => json({}))
  const data = await body(await host.request('qwen-token-plan-cn'))
  assert.equal(data.ok, false)
  assert.equal(data.reason, 'missing-console-token')
  assert.equal(calls.length, 0)
})

test('reads Fireworks month-to-date spend through account discovery', async (t) => {
  const host = createHarness({
    providers: {
      fireworks: { defaultBaseURL: 'https://api.fireworks.ai/v1', nativeEnv: ['FIREWORKS_API_KEY'] },
    },
    keys: { FIREWORKS_API_KEY: 'fw-key' },
  })
  const calls = mockFetch(t, async (url) => {
    if (String(url).endsWith('/accounts')) return json({ accounts: [{ name: 'accounts/acme' }] })
    return json({
      lineItems: [
        { category: 'Text Completion', totalCost: { currencyCode: 'USD', units: '12', nanos: 340_000_000 } },
        { category: 'Audio', totalCost: { currencyCode: 'USD', units: '0', nanos: 660_000_000 } },
      ],
    })
  })

  const data = await body(await host.request('fireworks'))
  assert.equal(data.ok, true)
  assert.equal(data.kind, 'fireworks')
  assert.equal(data.currency, 'USD')
  assert.equal(data.usedAmount, '13')
  assert.equal(calls[0].url, 'https://api.fireworks.ai/v1/accounts')
  assert.match(calls[1].url, /^https:\/\/api\.fireworks\.ai\/v1\/accounts\/acme\/billing\/summary\?startTime=/)
  assert.equal(calls[1].init.headers.Authorization, 'Bearer fw-key')
})

test('reads Baseten month-to-date usage with its credit split', async (t) => {
  const host = createHarness({
    providers: {
      baseten: { defaultBaseURL: 'https://inference.baseten.co/v1', nativeEnv: ['BASETEN_API_KEY'] },
    },
    keys: { BASETEN_API_KEY: 'bt-key' },
  })
  const calls = mockFetch(t, async () => json({
    dedicated_usage: null,
    training_usage: null,
    model_apis_usage: { subtotal: '3', credits_used: '1', total: '4' },
  }))

  const data = await body(await host.request('baseten'))
  assert.equal(data.ok, true)
  assert.equal(data.kind, 'baseten')
  assert.equal(data.usedAmount, '4')
  assert.equal(data.creditsAmount, '1')
  assert.equal(data.chargedAmount, '3')
  assert.match(calls[0].url, /^https:\/\/api\.baseten\.co\/v1\/billing\/usage_summary\?start_date=/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer bt-key')
})

test('reads Together AI month-to-date usage costs', async (t) => {
  const host = createHarness({
    providers: {
      together: { defaultBaseURL: 'https://api.together.ai/v1', nativeEnv: ['TOGETHER_API_KEY'] },
    },
    keys: { TOGETHER_API_KEY: 'tg-key' },
  })
  const calls = mockFetch(t, async () => json({
    object: 'list',
    currency: 'USD',
    data: [{ date: '2026-10-01', line_items: [{ cost: '0.25' }, { cost: '0.75' }] }],
  }))

  const data = await body(await host.request('together'))
  assert.equal(data.ok, true)
  assert.equal(data.kind, 'together')
  assert.equal(data.usedAmount, '1')
  assert.match(calls[0].url, /^https:\/\/api\.together\.ai\/v1\/billing\/usage\?month=\d{4}-\d{2}$/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tg-key')
})

test('reports missing keys for the usage adapters without calling upstream', async (t) => {
  const cases = [
    ['fireworks', 'https://api.fireworks.ai/v1', 'FIREWORKS_API_KEY'],
    ['baseten', 'https://inference.baseten.co/v1', 'BASETEN_API_KEY'],
    ['together', 'https://api.together.ai/v1', 'TOGETHER_API_KEY'],
  ]
  const calls = mockFetch(t, async () => json({}))
  for (const [provider, defaultBaseURL, env] of cases) {
    const host = createHarness({
      providers: { [provider]: { defaultBaseURL, nativeEnv: [env] } },
      keys: {},
    })
    const data = await body(await host.request(provider))
    assert.equal(data.reason, 'missing-credential', provider)
  }
  assert.equal(calls.length, 0)
})

test('rejects invalid usage payloads as temporary failures', async (t) => {
  const fireworks = createHarness({
    providers: { fireworks: { defaultBaseURL: 'https://api.fireworks.ai/v1', nativeEnv: ['FIREWORKS_API_KEY'] } },
    keys: { FIREWORKS_API_KEY: 'fw-key' },
  })
  const together = createHarness({
    providers: { together: { defaultBaseURL: 'https://api.together.ai/v1', nativeEnv: ['TOGETHER_API_KEY'] } },
    keys: { TOGETHER_API_KEY: 'tg-key' },
  })
  mockFetch(t, async () => json({}))

  const fireworksData = await body(await fireworks.request('fireworks'))
  assert.equal(fireworksData.reason, 'error')
  assert.match(fireworksData.error, /invalid quota response|no accessible/)

  const togetherData = await body(await together.request('together'))
  assert.equal(togetherData.reason, 'error')
  assert.match(togetherData.error, /invalid quota response/)
})

test('reads xAI prepaid balance and billing-cycle spend via the management key', async (t) => {
  const host = createHarness({
    providers: {
      xai: { defaultBaseURL: 'https://api.x.ai/v1', nativeEnv: ['XAI_API_KEY'] },
    },
    keys: { XAI_API_KEY: 'inference-key', XAI_MANAGEMENT_KEY: 'mg-key' },
  })
  const calls = mockFetch(t, async (url) => {
    const text = String(url)
    if (text.endsWith('/auth/management-keys/validation')) return json({ scope: 'SCOPE_TEAM', scopeId: 'team-1' })
    if (text.endsWith('/prepaid/balance')) return json({ changes: [], total: { val: '-4500' } })
    return json({ coreInvoice: { totalWithCorr: { val: '1234' } }, billingCycle: { year: 2026, month: 10 } })
  })

  const data = await body(await host.request('xai'))
  assert.equal(data.ok, true)
  assert.equal(data.kind, 'xai')
  assert.equal(data.currency, 'USD')
  assert.equal(data.amount, '45')
  assert.equal(data.cycleUsage, '12.34')
  assert.deepEqual(calls.map((call) => call.url), [
    'https://management-api.x.ai/auth/management-keys/validation',
    'https://management-api.x.ai/v1/billing/teams/team-1/prepaid/balance',
    'https://management-api.x.ai/v1/billing/teams/team-1/postpaid/invoice/preview',
  ])
  assert.equal(calls[0].init.headers.Authorization, 'Bearer mg-key')
})

test('reports a missing xAI management key and rejects non-team-scoped keys', async (t) => {
  const providers = {
    xai: { defaultBaseURL: 'https://api.x.ai/v1', nativeEnv: ['XAI_API_KEY'] },
  }
  const missing = createHarness({ providers, keys: { XAI_API_KEY: 'inference-key' } })
  let calls = mockFetch(t, async () => json({}))
  const missingData = await body(await missing.request('xai'))
  assert.equal(missingData.reason, 'missing-management-key')
  assert.equal(calls.length, 0)

  const scoped = createHarness({ providers, keys: { XAI_MANAGEMENT_KEY: 'mg-key' } })
  calls = mockFetch(t, async () => json({ scope: 'SCOPE_ORGANIZATION', scopeId: 'org-1' }))
  const scopedData = await body(await scoped.request('xai'))
  assert.equal(scopedData.reason, 'error')
  assert.match(scopedData.error, /not team-scoped/)
  assert.equal(calls.length, 1)
})
