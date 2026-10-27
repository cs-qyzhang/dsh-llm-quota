import test from 'node:test'
import assert from 'node:assert/strict'
import { read, routeFor, DEFAULT_ENDPOINT, KEY_NAMES } from '../providers/cloudflare.js'
import { currentUtcMonth } from '../providers/shared.js'

const ROUTE = {
  provider: 'cloudflare',
  kind: 'cloudflare',
  endpoint: DEFAULT_ENDPOINT,
}

const BALANCE_PAYLOAD = {
  success: true,
  errors: [],
  result: {
    balance: 12.5,
    has_default_payment_method: true,
    payment_method: { brand: 'visa', last4: '4242' },
    topup_config: { amount: 10, threshold: 5 },
    first_topup_success: true,
  },
}

const USAGE_PAYLOAD = {
  success: true,
  errors: [],
  result: {
    history: [
      { id: 'a', aggregated_value: 1.25, start_time: 1, end_time: 2 },
      { id: 'b', aggregated_value: 0.75, start_time: 3, end_time: 4 },
    ],
  },
}

function createCtx(map) {
  return {
    credentials: {
      resolve: async (name) => (map[name] ? { value: map[name] } : undefined),
    },
  }
}

function mockFetch(t, handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init }
    calls.push(call)
    const { status = 200, payload } = handler(call.url)
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload ?? null),
    }
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

function okHandler(url) {
  if (url.includes('/ai-gateway/billing/credit-balance')) return { payload: BALANCE_PAYLOAD }
  return { payload: USAGE_PAYLOAD }
}

test('reads prepaid balance and month-to-date usage', async (t) => {
  const calls = mockFetch(t, okHandler)
  const ctx = createCtx({ CLOUDFLARE_API_TOKEN: 'cf-test-token', CLOUDFLARE_ACCOUNT_ID: 'acct-123' })

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, true)
  assert.equal(data.provider, 'cloudflare')
  assert.equal(data.kind, 'cloudflare')
  assert.equal(data.currency, 'USD')
  assert.equal(data.amount, '12.5')
  assert.equal(data.cycleUsage, '2')
  assert.equal(data.hasPaymentMethod, true)
  assert.ok(data.updatedAt)

  assert.equal(calls.length, 2)
  assert.equal(
    calls[0].url,
    'https://api.cloudflare.com/client/v4/accounts/acct-123/ai-gateway/billing/credit-balance',
  )
  assert.equal(calls[0].init.headers.Authorization, 'Bearer cf-test-token')
  const usageUrl = new URL(calls[1].url)
  assert.equal(usageUrl.pathname, '/client/v4/accounts/acct-123/ai-gateway/billing/usage-history')
  assert.equal(usageUrl.searchParams.get('value_grouping_window'), 'day')
  const { startIso, endIso } = currentUtcMonth()
  assert.equal(usageUrl.searchParams.get('start_time'), String(Date.parse(startIso)))
  assert.equal(usageUrl.searchParams.get('end_time'), String(Date.parse(endIso)))
  assert.match(usageUrl.searchParams.get('start_time'), /^\d{13}$/)
})

test('reports only cycle usage when the credit-balance call fails', async (t) => {
  mockFetch(t, (url) => {
    if (url.includes('/credit-balance')) return { status: 500, payload: { success: false, errors: [] } }
    return { payload: USAGE_PAYLOAD }
  })
  const ctx = createCtx({ CLOUDFLARE_API_TOKEN: 'cf-test-token', CLOUDFLARE_ACCOUNT_ID: 'acct-123' })

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, true)
  assert.equal(data.kind, 'cloudflare')
  assert.equal(data.currency, 'USD')
  assert.equal(data.amount, undefined)
  assert.equal(data.cycleUsage, '2')
  assert.equal(data.hasPaymentMethod, undefined)
})

test('reports only the balance when the usage-history call fails', async (t) => {
  mockFetch(t, (url) => {
    if (url.includes('/usage-history')) return { status: 503, payload: { success: false, errors: [] } }
    return { payload: BALANCE_PAYLOAD }
  })
  const ctx = createCtx({ CLOUDFLARE_API_TOKEN: 'cf-test-token', CLOUDFLARE_ACCOUNT_ID: 'acct-123' })

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, true)
  assert.equal(data.kind, 'cloudflare')
  assert.equal(data.currency, 'USD')
  assert.equal(data.amount, '12.5')
  assert.equal(data.cycleUsage, undefined)
  assert.equal(data.hasPaymentMethod, true)
})

test('throws when both billing calls fail', async (t) => {
  mockFetch(t, () => ({ status: 500, payload: { success: false, errors: [] } }))
  const ctx = createCtx({ CLOUDFLARE_API_TOKEN: 'cf-test-token', CLOUDFLARE_ACCOUNT_ID: 'acct-123' })

  await assert.rejects(() => read(ctx, ROUTE), /HTTP 500/)
})

test('reports a missing token without calling upstream', async (t) => {
  const calls = mockFetch(t, okHandler)
  const ctx = createCtx({ CLOUDFLARE_ACCOUNT_ID: 'acct-123' })

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, false)
  assert.equal(data.kind, 'cloudflare')
  assert.equal(data.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('reports a missing account id without calling upstream', async (t) => {
  const calls = mockFetch(t, okHandler)
  const ctx = createCtx({ CLOUDFLARE_API_TOKEN: 'cf-test-token' })

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, false)
  assert.equal(data.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('rejects invalid quota payloads', async (t) => {
  mockFetch(t, () => ({ payload: { success: false, errors: [{ code: 1000, message: 'auth error' }] } }))
  const ctx = createCtx({ CLOUDFLARE_API_TOKEN: 'cf-test-token', CLOUDFLARE_ACCOUNT_ID: 'acct-123' })

  await assert.rejects(() => read(ctx, ROUTE), /invalid quota response/)
})

test('rejects usage payloads without a history array', async (t) => {
  mockFetch(t, (url) => {
    if (url.includes('/usage-history')) return { payload: { success: true, errors: [], result: {} } }
    return { payload: BALANCE_PAYLOAD }
  })
  const ctx = createCtx({ CLOUDFLARE_API_TOKEN: 'cf-test-token', CLOUDFLARE_ACCOUNT_ID: 'acct-123' })

  await assert.rejects(() => read(ctx, ROUTE), /invalid quota response/)
})

test('routeFor matches Cloudflare hosts and rejects others', () => {
  assert.deepEqual(routeFor('https://api.cloudflare.com/client/v4'), { endpoint: DEFAULT_ENDPOINT })
  assert.deepEqual(routeFor('https://gateway.ai.cloudflare.com/v1/account/gateway'), { endpoint: DEFAULT_ENDPOINT })
  assert.deepEqual(routeFor('https://my-account.workers.dev/v1'), { endpoint: DEFAULT_ENDPOINT })
  assert.equal(routeFor('https://api.openai.com/v1'), undefined)
  assert.equal(routeFor('https://workers.dev'), undefined)
  assert.equal(routeFor('not a url'), undefined)
})

test('falls back to the default key names when the route has none', async (t) => {
  const calls = mockFetch(t, okHandler)
  const ctx = createCtx({ CLOUDFLARE_API_KEY: 'cf-global-key', CLOUDFLARE_ACCOUNT_ID: 'acct-123' })

  const data = await read(ctx, { provider: 'cloudflare', kind: 'cloudflare', endpoint: DEFAULT_ENDPOINT })

  assert.equal(data.ok, true)
  assert.equal(data.amount, '12.5')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer cf-global-key')
  assert.deepEqual(KEY_NAMES, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY'])
})
