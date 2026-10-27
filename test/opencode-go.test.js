import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ENDPOINT,
  KEY_NAMES,
  kind,
  read,
  routeFor,
} from '../providers/opencode-go.js'

const USAGE_RESPONSE = {
  usage: {
    rolling: { status: 'ok', percent: 32, resetsAt: '2026-10-27T12:00:00.000Z' },
    weekly: { status: 'ok', percent: 53.6, resetsAt: '2026-11-02T00:00:00Z' },
    monthly: { status: 'rate-limited', percent: 95, resetsAt: '2026-11-01T00:00:00.000Z' },
  },
}

function fakeCtx(map) {
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
      text: async () => JSON.stringify(payload),
    }
  }
  return calls
}

function route() {
  return { provider: 'opencode-go', kind, endpoint: DEFAULT_ENDPOINT }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function assertWindow(window, usedPercent, resetAt) {
  assert.equal(window.usedPercent, usedPercent)
  assert.equal(window.remainingPercent, 100 - usedPercent)
  assert.equal(window.usedPercent + window.remainingPercent, 100)
  assert.match(window.resetAt, ISO_RE)
  assert.equal(window.resetAt, new Date(resetAt).toISOString())
}

test('read maps rolling/weekly/monthly windows and rate-limited status', async () => {
  const calls = mockFetch(USAGE_RESPONSE)

  const result = await read(fakeCtx({ OPENCODE_GO_API_KEY: 'sk-test' }), route())

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'opencode-go')
  assert.equal(result.kind, 'opencode-go')
  assert.match(result.updatedAt, ISO_RE)

  assertWindow(result.fiveHour, 32, '2026-10-27T12:00:00.000Z')
  assertWindow(result.weekly, 54, '2026-11-02T00:00:00.000Z')
  assertWindow(result.monthly, 95, '2026-11-01T00:00:00.000Z')
  assert.equal(result.status, 'rate-limited')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, DEFAULT_ENDPOINT)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test')
})

test('read falls back to the secondary credential name', async () => {
  mockFetch(USAGE_RESPONSE)

  const result = await read(fakeCtx({ OPENCODE_API_KEY: 'sk-fallback' }), route())

  assert.equal(result.ok, true)
  assert.deepEqual(KEY_NAMES, ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'])
})

test('read returns missing-credential without calling fetch', async () => {
  const calls = mockFetch(USAGE_RESPONSE)

  const result = await read(fakeCtx({}), route())

  assert.equal(result.ok, false)
  assert.equal(result.provider, 'opencode-go')
  assert.equal(result.kind, 'opencode-go')
  assert.equal(result.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('read throws on an invalid quota payload', async () => {
  mockFetch({ usage: { rolling: { status: 'ok', percent: 'n/a' } } })

  await assert.rejects(
    () => read(fakeCtx({ OPENCODE_GO_API_KEY: 'sk-test' }), route()),
    /invalid quota response/,
  )

  mockFetch({})

  await assert.rejects(
    () => read(fakeCtx({ OPENCODE_GO_API_KEY: 'sk-test' }), route()),
    /invalid quota response/,
  )
})

test('routeFor matches only opencode.ai /zen/go URLs', () => {
  assert.deepEqual(routeFor('https://opencode.ai/zen/go/v1'), { endpoint: DEFAULT_ENDPOINT })
  assert.deepEqual(routeFor('https://opencode.ai/zen/go'), { endpoint: DEFAULT_ENDPOINT })
  assert.deepEqual(routeFor('https://opencode.ai/zen/go/'), { endpoint: DEFAULT_ENDPOINT })
  assert.equal(routeFor('https://opencode.ai/zen/v1'), undefined)
  assert.equal(routeFor('https://opencode.ai/zen'), undefined)
  assert.equal(routeFor('https://example.com/zen/go/v1'), undefined)
  assert.equal(routeFor('not a url'), undefined)
})
