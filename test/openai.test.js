import test from 'node:test'
import assert from 'node:assert/strict'
import { currentUtcMonth } from '../providers/shared.js'
import {
  DEFAULT_ENDPOINT,
  KEY_NAMES,
  kind,
  read,
  routeFor,
} from '../providers/openai.js'

// Costs are decimal USD values: 1.25 + 0.5 + 0.125 + 0.125 = 2.00 for the month.
const COST_RESPONSE = {
  object: 'page',
  results: [
    { object: 'organization.costs.result', amount: { value: 1.25, currency: 'usd' }, line_item: 'gpt-4o', project_id: 'proj_a' },
    { object: 'organization.costs.result', amount: { value: 0.5, currency: 'usd' }, line_item: 'gpt-4o-mini', project_id: null },
    { object: 'organization.costs.result', amount: { value: 0.125, currency: 'usd' }, line_item: null, project_id: 'proj_b' },
    { object: 'organization.costs.result', amount: { value: 0.125, currency: 'usd' }, line_item: 'whisper', project_id: null },
  ],
  has_more: false,
  next_page: null,
}

const USAGE_RESPONSE = {
  object: 'page',
  data: [
    {
      object: 'bucket',
      start_time: 1759968000,
      end_time: 1760054400,
      results: [
        {
          object: 'organization.usage.completions.result',
          input_tokens: 1000,
          output_tokens: 200,
          input_cached_tokens: 100,
          num_model_requests: 7,
        },
      ],
    },
    {
      object: 'bucket',
      start_time: 1760054400,
      end_time: 1760140800,
      results: [
        {
          object: 'organization.usage.completions.result',
          input_tokens: 50,
          output_tokens: 10,
          input_cached_tokens: 0,
          num_model_requests: 3,
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
  return { provider: 'openai', kind, endpoint: DEFAULT_ENDPOINT }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

test('read sums cost amounts and sends the admin key with month start_time', async () => {
  const calls = mockFetch((url) => (url.includes('/usage/completions') ? USAGE_RESPONSE : COST_RESPONSE))

  const result = await read(fakeCtx({ OPENAI_ADMIN_KEY: 'sk-admin-test' }), route())

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'openai')
  assert.equal(result.kind, 'openai')
  assert.equal(result.currency, 'USD')
  assert.equal(result.usedAmount, '2')
  assert.match(result.updatedAt, ISO_RE)
  assert.equal(result.inputTokens, 1050)
  assert.equal(result.outputTokens, 210)
  assert.equal(result.requestCount, 10)

  assert.equal(calls.length, 2)
  const costCall = calls.find((call) => String(call.url).includes('/organization/costs'))
  assert.equal(costCall.options.headers.Authorization, 'Bearer sk-admin-test')

  const { startIso, endIso } = currentUtcMonth()
  const url = new URL(costCall.url)
  assert.equal(url.origin + url.pathname, DEFAULT_ENDPOINT)
  assert.equal(url.searchParams.get('start_time'), String(Math.floor(Date.parse(startIso) / 1000)))
  assert.equal(url.searchParams.get('end_time'), String(Math.floor(Date.parse(endIso) / 1000)))
  assert.equal(url.searchParams.get('bucket_width'), '1d')
  assert.ok(calls.some((call) => String(call.url).includes('/v1/organization/usage/completions')))
})

test('read aggregates paginated cost results', async () => {
  const calls = mockFetch((url) => {
    if (url.includes('/usage/completions')) return USAGE_RESPONSE
    if (url.includes('page=page_2')) {
      return {
        results: [
          { amount: { value: 0.75, currency: 'usd' }, line_item: 'gpt-4o' },
          { amount: { value: 0.25, currency: 'usd' }, line_item: null },
        ],
        has_more: false,
        next_page: null,
      }
    }
    return {
      results: [{ amount: { value: 1, currency: 'usd' }, line_item: 'gpt-4o' }],
      has_more: true,
      next_page: 'page_2',
    }
  })

  const result = await read(fakeCtx({ OPENAI_ADMIN_API_KEY: 'sk-admin-test' }), route())

  assert.equal(result.ok, true)
  assert.equal(result.usedAmount, '2')
  assert.equal(result.requestCount, 10)
  const costCalls = calls.filter((call) => String(call.url).includes('/organization/costs'))
  assert.equal(costCalls.length, 2)
  assert.ok(String(costCalls[1].url).includes('page=page_2'))
})

test('read returns missing-credential without calling fetch', async () => {
  const calls = mockFetch(COST_RESPONSE)

  const result = await read(fakeCtx({}), route())

  assert.equal(result.ok, false)
  assert.equal(result.provider, 'openai')
  assert.equal(result.kind, 'openai')
  assert.equal(result.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('read throws on an invalid quota payload', async () => {
  mockFetch({ object: 'page', data: [] })

  await assert.rejects(
    () => read(fakeCtx({ OPENAI_ADMIN_KEY: 'sk-admin-test' }), route()),
    /invalid quota response/,
  )

  mockFetch({ results: [{ amount: { value: 'n/a', currency: 'usd' } }] })

  await assert.rejects(
    () => read(fakeCtx({ OPENAI_ADMIN_KEY: 'sk-admin-test' }), route()),
    /invalid quota response/,
  )
})

test('read tolerates a failing usage call and still returns cost', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (String(url).includes('/usage/completions')) {
      return { ok: false, status: 500, text: async () => 'boom' }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(COST_RESPONSE) }
  }

  const result = await read(fakeCtx({ OPENAI_ADMIN_KEY: 'sk-admin-test' }), route())

  assert.equal(result.ok, true)
  assert.equal(result.usedAmount, '2')
  assert.equal('inputTokens' in result, false)
  assert.equal('outputTokens' in result, false)
  assert.equal('requestCount' in result, false)
  assert.equal(calls.length, 2)
})

test('routeFor matches only the OpenAI API host', () => {
  assert.deepEqual(KEY_NAMES, ['OPENAI_ADMIN_KEY', 'OPENAI_ADMIN_API_KEY'])
  assert.deepEqual(routeFor('https://api.openai.com'), { endpoint: DEFAULT_ENDPOINT, keyNames: KEY_NAMES })
  assert.deepEqual(routeFor('https://api.openai.com/v1/chat/completions'), { endpoint: DEFAULT_ENDPOINT, keyNames: KEY_NAMES })
  assert.equal(routeFor('https://platform.openai.com/'), undefined)
  assert.equal(routeFor('https://api.openai.com.evil.example/'), undefined)
  assert.equal(routeFor('not a url'), undefined)
})
