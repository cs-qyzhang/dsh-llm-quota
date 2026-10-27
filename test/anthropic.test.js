import test from 'node:test'
import assert from 'node:assert/strict'
import { currentUtcMonth } from '../providers/shared.js'
import {
  DEFAULT_ENDPOINT,
  KEY_NAMES,
  kind,
  read,
  routeFor,
} from '../providers/anthropic.js'

// Amounts are USD cents as decimal strings: 123.45 + 100 + 50.5 + 26.05 = 300
// cents, i.e. $3.00 for the month.
const COST_RESPONSE = {
  data: [
    {
      starting_at: '2026-10-01T00:00:00Z',
      ending_at: '2026-10-02T00:00:00Z',
      results: [
        { amount: '123.45', currency: 'USD', cost_type: 'tokens', model: 'claude-sonnet-4-5' },
        { amount: '100', currency: 'USD', cost_type: 'tokens', model: null },
        { amount: '50.5', currency: 'USD', cost_type: 'web_search', model: null },
      ],
    },
    {
      starting_at: '2026-10-02T00:00:00Z',
      ending_at: '2026-10-03T00:00:00Z',
      results: [
        { amount: '26.05', currency: 'USD', cost_type: 'code_execution', model: null },
      ],
    },
  ],
  has_more: false,
  next_page: null,
}

const USAGE_RESPONSE = {
  data: [
    {
      starting_at: '2026-10-01T00:00:00Z',
      ending_at: '2026-10-02T00:00:00Z',
      results: [
        {
          uncached_input_tokens: 100,
          cache_read_input_tokens: 50,
          output_tokens: 25,
          cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 },
        },
        {
          uncached_input_tokens: 5,
          cache_read_input_tokens: 0,
          output_tokens: 1,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        },
      ],
    },
  ],
  has_more: false,
  next_page: null,
}

function fakeCtx(map) {
  return {
    credentials: {
      resolve: async (name) => (map[name] ? { value: map[name] } : undefined),
    },
  }
}

function mockFetch(payload) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    const body = typeof payload === 'function' ? payload(String(url)) : payload
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }
  }
  return calls
}

function route() {
  return { provider: 'anthropic', kind, endpoint: DEFAULT_ENDPOINT }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

test('read sums cost report amounts in cents and sends admin headers', async () => {
  const calls = mockFetch((url) => (url.includes('usage_report') ? USAGE_RESPONSE : COST_RESPONSE))

  const result = await read(fakeCtx({ ANTHROPIC_ADMIN_API_KEY: 'sk-ant-admin-test' }), route())

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'anthropic')
  assert.equal(result.kind, 'anthropic')
  assert.equal(result.currency, 'USD')
  assert.equal(result.usedAmount, '3')
  assert.match(result.updatedAt, ISO_RE)
  assert.deepEqual(result.costTypeBreakdown, {
    tokens: '2.2345',
    web_search: '0.505',
    code_execution: '0.2605',
  })
  assert.equal(result.inputTokens, 170)
  assert.equal(result.outputTokens, 26)

  assert.equal(calls.length, 2)
  const costCall = calls[0]
  assert.equal(costCall.options.headers['x-api-key'], 'sk-ant-admin-test')
  assert.equal(costCall.options.headers['anthropic-version'], '2023-06-01')

  const url = new URL(costCall.url)
  assert.equal(url.origin + url.pathname, DEFAULT_ENDPOINT)
  assert.equal(url.searchParams.get('bucket_width'), '1d')
  assert.ok(url.searchParams.get('starting_at').startsWith(currentUtcMonth().month))
  assert.ok(url.searchParams.get('ending_at'))
  assert.ok(String(calls[1].url).includes('/v1/organizations/usage_report/messages'))
})

test('read returns missing-credential without calling fetch', async () => {
  const calls = mockFetch(COST_RESPONSE)

  const result = await read(fakeCtx({}), route())

  assert.equal(result.ok, false)
  assert.equal(result.provider, 'anthropic')
  assert.equal(result.kind, 'anthropic')
  assert.equal(result.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('read throws on an invalid quota payload', async () => {
  mockFetch({ data: {} })

  await assert.rejects(
    () => read(fakeCtx({ ANTHROPIC_ADMIN_KEY: 'sk-ant-admin-test' }), route()),
    /invalid quota response/,
  )

  mockFetch({ data: [{ starting_at: '2026-10-01T00:00:00Z' }] })

  await assert.rejects(
    () => read(fakeCtx({ ANTHROPIC_ADMIN_KEY: 'sk-ant-admin-test' }), route()),
    /invalid quota response/,
  )

  mockFetch({ data: [{ results: [{ amount: 'n/a' }] }] })

  await assert.rejects(
    () => read(fakeCtx({ ANTHROPIC_ADMIN_KEY: 'sk-ant-admin-test' }), route()),
    /invalid quota response/,
  )
})

test('read tolerates a failing usage report and still returns cost', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (String(url).includes('usage_report')) {
      return { ok: false, status: 500, text: async () => 'boom' }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(COST_RESPONSE) }
  }

  const result = await read(fakeCtx({ ANTHROPIC_ADMIN_KEY: 'sk-ant-admin-test' }), route())

  assert.equal(result.ok, true)
  assert.equal(result.usedAmount, '3')
  assert.equal('inputTokens' in result, false)
  assert.equal('outputTokens' in result, false)
  assert.equal(calls.length, 2)
})

test('routeFor matches only Anthropic API hosts', () => {
  assert.deepEqual(KEY_NAMES, ['ANTHROPIC_ADMIN_KEY', 'ANTHROPIC_ADMIN_API_KEY'])
  assert.deepEqual(routeFor('https://api.anthropic.com'), { endpoint: DEFAULT_ENDPOINT, keyNames: KEY_NAMES })
  assert.deepEqual(routeFor('https://api.anthropic.com/v1/messages'), { endpoint: DEFAULT_ENDPOINT, keyNames: KEY_NAMES })
  assert.deepEqual(routeFor('https://claude.com/v1'), { endpoint: DEFAULT_ENDPOINT, keyNames: KEY_NAMES })
  assert.equal(routeFor('https://console.anthropic.com/'), undefined)
  assert.equal(routeFor('https://api.anthropic.com.evil.example/'), undefined)
  assert.equal(routeFor('not a url'), undefined)
})
