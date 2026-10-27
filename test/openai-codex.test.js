import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ENDPOINT,
  KEY_NAMES,
  read,
  routeFor,
} from '../providers/openai-codex.js'

const ROUTE = { provider: 'codex', kind: 'openai-codex' }
const CREDENTIALS = {
  OPENAI_CODEX_TOKEN: 'codex-token',
  OPENAI_CODEX_ACCOUNT_ID: 'acc_123',
}

const originalFetch = globalThis.fetch
test.after(() => {
  globalThis.fetch = originalFetch
})

function createCtx(map = {}) {
  return {
    credentials: {
      resolve: async (name) => (map[name] ? { value: map[name] } : undefined),
    },
  }
}

function mockFetch(payload, init = {}) {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    }
  }
  return calls
}

test('happy path maps primary/secondary windows and sends ChatGPT-Account-Id', async () => {
  const calls = mockFetch({
    account_id: 'acc_123',
    user_id: 'user_123',
    plan_type: 'plus',
    rate_limit: {
      primary_window: {
        used_percent: 30.6,
        limit_window_seconds: 18000,
        reset_after_seconds: 7200,
        reset_at: '2026-10-27T12:00:00Z',
      },
      secondary_window: {
        used_percent: 62.2,
        limit_window_seconds: 604800,
        reset_after_seconds: 259200,
        reset_at: '2026-11-01T00:00:00Z',
      },
    },
    rate_limit_reset_credits: { available_count: 2 },
    additional_rate_limits: [{ label: 'heavy-user', used_percent: 10 }],
  })

  const result = await read(createCtx(CREDENTIALS), ROUTE)

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'codex')
  assert.equal(result.kind, 'openai-codex')
  assert.equal(result.planType, 'plus')
  assert.equal(result.fiveHour.usedPercent, 31)
  assert.equal(result.fiveHour.remainingPercent, 69)
  assert.equal(result.fiveHour.usedPercent + result.fiveHour.remainingPercent, 100)
  assert.equal(result.fiveHour.resetAt, '2026-10-27T12:00:00.000Z')
  assert.equal(result.weekly.usedPercent, 62)
  assert.equal(result.weekly.remainingPercent, 38)
  assert.equal(result.weekly.usedPercent + result.weekly.remainingPercent, 100)
  assert.equal(result.weekly.resetAt, '2026-11-01T00:00:00.000Z')
  assert.equal(result.resetCredits, 2)
  assert.equal(result.windows.length, 1)
  assert.equal(result.windows[0].label, 'heavy-user')
  assert.equal(result.windows[0].usedPercent, 10)
  assert.equal(result.windows[0].remainingPercent, 90)
  assert.match(result.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://chatgpt.com/backend-api/wham/usage')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer codex-token')
  assert.equal(calls[0].options.headers['ChatGPT-Account-Id'], 'acc_123')
  assert.equal(calls[0].options.headers.Accept, 'application/json')
})

test('derives resetAt from reset_after_seconds when reset_at is missing', async () => {
  mockFetch({
    plan_type: 'pro',
    rate_limit: {
      primary_window: { used_percent: 42, reset_after_seconds: 3600 },
      secondary_window: { used_percent: 5, reset_at: '2026-11-01T00:00:00Z' },
    },
  })

  const before = Date.now()
  const result = await read(createCtx(CREDENTIALS), ROUTE)
  const after = Date.now()

  assert.equal(result.ok, true)
  assert.equal(result.fiveHour.usedPercent, 42)
  const resetMs = Date.parse(result.fiveHour.resetAt)
  assert.ok(resetMs >= before + 3600 * 1000)
  assert.ok(resetMs <= after + 3600 * 1000)
  assert.equal(result.weekly.resetAt, '2026-11-01T00:00:00.000Z')
})

test('missing OAuth token returns unavailable without calling fetch', async () => {
  const calls = mockFetch({})

  const result = await read(createCtx({ OPENAI_CODEX_ACCOUNT_ID: 'acc_123' }), ROUTE)

  assert.equal(result.ok, false)
  assert.equal(result.provider, 'codex')
  assert.equal(result.kind, 'openai-codex')
  assert.equal(result.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('missing account id returns unavailable without calling fetch', async () => {
  const calls = mockFetch({})

  const result = await read(createCtx({ OPENAI_CODEX_TOKEN: 'codex-token' }), ROUTE)

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('missing primary_window throws invalid quota response', async () => {
  mockFetch({
    plan_type: 'plus',
    rate_limit: { secondary_window: { used_percent: 5 } },
  })

  await assert.rejects(() => read(createCtx(CREDENTIALS), ROUTE), {
    message: 'invalid quota response',
  })
})

test('unparseable used_percent throws invalid quota response', async () => {
  mockFetch({
    plan_type: 'plus',
    rate_limit: { primary_window: { used_percent: 'high' } },
  })

  await assert.rejects(() => read(createCtx(CREDENTIALS), ROUTE), {
    message: 'invalid quota response',
  })
})

test('routeFor matches chatgpt.com /backend-api and rejects other URLs', () => {
  assert.deepEqual(routeFor('https://chatgpt.com/backend-api/wham/usage'), {
    endpoint: DEFAULT_ENDPOINT,
    keyNames: KEY_NAMES,
  })
  assert.deepEqual(routeFor('https://chatgpt.com/backend-api/codex'), {
    endpoint: DEFAULT_ENDPOINT,
    keyNames: KEY_NAMES,
  })
  assert.equal(routeFor('https://chatgpt.com/codex'), undefined)
  assert.equal(routeFor('https://api.openai.com/v1'), undefined)
  assert.equal(routeFor('not a url'), undefined)
})
