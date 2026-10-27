import test from 'node:test'
import assert from 'node:assert/strict'
import { KEY_NAMES, read } from '../providers/github-copilot.js'

const ROUTE = { provider: 'github', kind: 'github-copilot' }

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

test('happy path maps premium_interactions to plan percentages', async () => {
  const calls = mockFetch({
    copilot_plan: 'pro',
    quota_reset_date: '2026-11-01T00:00:00Z',
    quota_snapshots: {
      premium_interactions: {
        entitlement: 300,
        quota_remaining: 120,
        percent_remaining: 40,
        overage_count: 0,
        overage_permitted: false,
        unlimited: false,
      },
      chat: {
        entitlement: 100,
        quota_remaining: 25,
        percent_remaining: 25,
        overage_permitted: false,
        unlimited: false,
      },
    },
  })

  const result = await read(createCtx({ GITHUB_TOKEN: 'gho_test' }), ROUTE)

  assert.equal(result.ok, true)
  assert.equal(result.provider, 'github')
  assert.equal(result.kind, 'github-copilot')
  assert.equal(result.planName, 'pro')
  assert.equal(result.plan.remainingPercent, 40)
  assert.equal(result.plan.usedPercent, 60)
  assert.equal(result.plan.usedPercent + result.plan.remainingPercent, 100)
  assert.equal(result.plan.resetAt, '2026-11-01T00:00:00.000Z')
  assert.match(result.plan.resetAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(result.plan.unlimited, undefined)
  assert.deepEqual(result.chat, { remainingPercent: 25, usedPercent: 75 })
  assert.match(result.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.github.com/copilot_internal/user')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer gho_test')
  assert.equal(calls[0].options.headers['Copilot-Integration-Id'], 'vscode-chat')
})

test('derives percentages from entitlement/quota_remaining when percent_remaining is missing', async () => {
  mockFetch({
    copilot_plan: 'pro+',
    quota_reset_date: '2026-11-01T00:00:00Z',
    quota_snapshots: {
      premium_interactions: {
        entitlement: 200,
        quota_remaining: 50,
      },
    },
  })

  const result = await read(createCtx({ GITHUB_TOKEN: 'gho_test' }), ROUTE)

  assert.equal(result.ok, true)
  assert.equal(result.plan.remainingPercent, 25)
  assert.equal(result.plan.usedPercent, 75)
  assert.equal(result.plan.usedPercent + result.plan.remainingPercent, 100)
})

test('falls back to the remaining field when quota_remaining is missing', async () => {
  mockFetch({
    copilot_plan: 'free',
    quota_reset_date: '2026-11-01T00:00:00Z',
    quota_snapshots: {
      premium_interactions: {
        entitlement: 4,
        remaining: 3,
      },
    },
  })

  const result = await read(createCtx({ GITHUB_TOKEN: 'gho_test' }), ROUTE)

  assert.equal(result.plan.remainingPercent, 75)
  assert.equal(result.plan.usedPercent, 25)
})

test('marks plan unlimited while keeping percent_remaining', async () => {
  mockFetch({
    copilot_plan: 'business',
    quota_reset_date: '2026-11-01T00:00:00Z',
    quota_snapshots: {
      premium_interactions: {
        entitlement: 100,
        quota_remaining: 92,
        percent_remaining: 92,
        overage_permitted: false,
        unlimited: true,
      },
    },
  })

  const result = await read(createCtx({ GITHUB_TOKEN: 'gho_test' }), ROUTE)

  assert.equal(result.plan.unlimited, true)
  assert.equal(result.plan.remainingPercent, 92)
  assert.equal(result.plan.usedPercent, 8)
})

test('overage_permitted alone also marks plan unlimited', async () => {
  mockFetch({
    copilot_plan: 'enterprise',
    quota_snapshots: {
      premium_interactions: {
        percent_remaining: 50,
        overage_permitted: true,
      },
    },
  })

  const result = await read(createCtx({ GITHUB_TOKEN: 'gho_test' }), ROUTE)

  assert.equal(result.plan.unlimited, true)
  assert.equal(result.plan.remainingPercent, 50)
  assert.equal(result.plan.resetAt, undefined)
})

test('missing credential returns unavailable without calling fetch', async () => {
  const calls = mockFetch({})

  const result = await read(createCtx({}), ROUTE)

  assert.equal(result.ok, false)
  assert.equal(result.provider, 'github')
  assert.equal(result.kind, 'github-copilot')
  assert.equal(result.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('missing premium_interactions throws invalid quota response', async () => {
  mockFetch({
    copilot_plan: 'pro',
    quota_snapshots: { chat: { percent_remaining: 50 } },
  })

  await assert.rejects(() => read(createCtx({ GITHUB_TOKEN: 'gho_test' }), ROUTE), {
    message: 'invalid quota response',
  })
})

test('premium_interactions without computable percentages throws invalid quota response', async () => {
  mockFetch({
    copilot_plan: 'pro',
    quota_snapshots: { premium_interactions: { overage_count: 0 } },
  })

  await assert.rejects(() => read(createCtx({ GITHUB_TOKEN: 'gho_test' }), ROUTE), {
    message: 'invalid quota response',
  })
})

test('uses KEY_NAMES as the default credential lookup list', async () => {
  mockFetch({
    copilot_plan: 'pro',
    quota_snapshots: { premium_interactions: { percent_remaining: 100 } },
  })

  const result = await read(createCtx({ [KEY_NAMES[0]]: 'ghp_test' }), ROUTE)

  assert.equal(result.ok, true)
  assert.equal(result.plan.remainingPercent, 100)
})
