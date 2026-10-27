import test from 'node:test'
import assert from 'node:assert/strict'
import * as radius from '../providers/radius.js'

const ROUTE = {
  provider: 'radius',
  kind: 'radius',
  endpoint: 'https://radius.pi.dev',
  keyNames: ['RADIUS_API_KEY'],
}

const ORGANIZATIONS_RESPONSE = {
  ok: true,
  organizations: [
    { id: 'org-1', name: 'Acme', slug: 'acme', role: 'member', selected: true },
  ],
}

const BILLING_RESPONSE = {
  ok: true,
  currency: 'USD',
  as_of: '2026-10-27T08:00:00Z',
  balance: {
    credit_balance: 120.5,
    reserved: 5.25,
    available: 115.25,
    updated_at: '2026-10-27T07:59:00Z',
  },
  current_period: {
    starts_at: '2026-10-01T00:00:00Z',
    ends_at: '2026-11-01T00:00:00Z',
    actual_charged: 12.34,
    actual_charge_count: 42,
  },
  all_time: {
    credited: 500,
    credit_count: 5,
    actual_charged: 384.75,
    actual_charge_count: 1200,
  },
  capabilities: {
    create_checkout_session: true,
    create_portal_session: 'allowed',
    redeem_credit_code: true,
  },
}

function createCtx(map) {
  return {
    credentials: {
      async resolve(name) {
        return map[name] ? { value: map[name] } : undefined
      },
    },
  }
}

function mockFetch(t, implementation) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return implementation(String(url), init, calls.length)
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

function json(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }
}

test('reads the Radius billing balance and current-period spend', async (t) => {
  const calls = mockFetch(t, async (_url, _init, count) => (
    count === 1 ? json(ORGANIZATIONS_RESPONSE) : json(BILLING_RESPONSE)
  ))

  const result = await radius.read(createCtx({ RADIUS_API_KEY: 'radius-key' }), ROUTE)
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'radius')
  assert.equal(result.kind, 'balance')
  assert.equal(result.service, 'radius')
  assert.equal(result.currency, 'USD')
  assert.equal(result.amount, '115.25')
  assert.equal(result.cycleUsage, '12.34')
  assert.equal(result.creditBalance, '120.5')
  assert.equal(result.reserved, '5.25')
  assert.equal(result.allTimeCharged, '384.75')
  assert.equal(typeof result.updatedAt, 'string')
  assert.equal(calls[1].init.headers.Authorization, 'Bearer radius-key')
})

test('discovers the organization before reading billing', async (t) => {
  const calls = mockFetch(t, async (_url, _init, count) => (
    count === 1 ? json(ORGANIZATIONS_RESPONSE) : json(BILLING_RESPONSE)
  ))

  await radius.read(createCtx({ RADIUS_API_KEY: 'radius-key' }), ROUTE)
  assert.deepEqual(calls.map((call) => call.url), [
    'https://radius.pi.dev/v1/organizations',
    'https://radius.pi.dev/v1/organizations/org-1/billing',
  ])
})

test('reports a missing Radius key without calling upstream', async (t) => {
  const calls = mockFetch(t, async () => json(BILLING_RESPONSE))

  const result = await radius.read(createCtx({}), ROUTE)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('rejects invalid Radius payloads as temporary errors', async (t) => {
  mockFetch(t, async (_url, _init, count) => (
    count === 1 ? json(ORGANIZATIONS_RESPONSE) : json({ ok: true, currency: 'USD' })
  ))

  await assert.rejects(
    radius.read(createCtx({ RADIUS_API_KEY: 'radius-key' }), ROUTE),
    { message: 'invalid quota response' },
  )
})
