import test from 'node:test'
import assert from 'node:assert/strict'
import { read } from '../providers/huggingface.js'

const ROUTE = {
  provider: 'huggingface',
  kind: 'huggingface',
  endpoint: 'https://huggingface.co/api/settings/billing/usage-v2',
  keyNames: ['HF_TOKEN', 'HUGGINGFACE_TOKEN'],
}

const PERIOD_USAGE_RESPONSE = {
  currency: 'USD',
  periods: [
    {
      period: '2026-10-01T00:00:00.000Z',
      usage: [
        {
          user: null,
          model: 'deepseek-ai/DeepSeek-V3-0324',
          provider: 'fireworks-ai',
          requestCount: 12,
          costCents: 250,
          inputTokens: 1000,
          outputTokens: 400,
          cachedInputTokens: 100,
        },
        {
          user: null,
          model: 'Qwen/Qwen3-32B',
          provider: 'together',
          requestCount: 3,
          costCents: 75,
          inputTokens: 200,
          outputTokens: 80,
          cachedInputTokens: 0,
        },
      ],
    },
  ],
}

const PRODUCT_USAGE_RESPONSE = {
  usage: {
    Endpoints: [
      {
        entityId: 'a'.repeat(24),
        label: 'ep-1',
        product: 'endpoints/aws/nvidia-t4/x1',
        quantity: 3,
        productPrettyName: 'NVIDIA T4 (x1)',
        unitLabel: null,
        totalCostMicroUSD: 2_500_000,
        unitCostMicroUSD: 833_333.33,
        active: true,
      },
    ],
  },
  period: {
    _id: 'b'.repeat(24),
    entityId: 'c'.repeat(24),
    entityType: 'user',
    entityName: 'alice',
    periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-10-27T00:00:00.000Z',
  },
}

function createCtx(map) {
  return {
    credentials: {
      resolve: async (name) => (map[name] ? { value: map[name] } : undefined),
    },
  }
}

function mockFetch(t, payload) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

test('reads month-to-date spend and usage extras from period usage rows', async (t) => {
  const calls = mockFetch(t, PERIOD_USAGE_RESPONSE)
  const ctx = createCtx({ HF_TOKEN: 'hf-test-token' })

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, true)
  assert.equal(data.provider, 'huggingface')
  assert.equal(data.kind, 'huggingface')
  assert.equal(data.currency, 'USD')
  assert.equal(data.usedAmount, '3.25')
  assert.equal(data.requestCount, 15)
  assert.equal(data.inputTokens, 1200)
  assert.equal(data.outputTokens, 480)
  assert.equal(data.cachedInputTokens, 100)
  assert.ok(data.updatedAt)

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /^https:\/\/huggingface\.co\/api\/settings\/billing\/usage-v2\?startDate=\d{10}&endDate=\d{10}$/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer hf-test-token')
})

test('reads micro-USD product usage rows from the grouped billing shape', async (t) => {
  mockFetch(t, PRODUCT_USAGE_RESPONSE)
  const ctx = createCtx({ HUGGINGFACE_TOKEN: 'hf-test-token' })

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, true)
  assert.equal(data.kind, 'huggingface')
  assert.equal(data.currency, 'USD')
  assert.equal(data.usedAmount, '2.5')
  assert.equal(data.usageOnly, undefined)
  assert.equal(data.requestCount, undefined)
})

test('reports a missing credential without calling upstream', async (t) => {
  const calls = mockFetch(t, PERIOD_USAGE_RESPONSE)
  const ctx = createCtx({})

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, false)
  assert.equal(data.reason, 'missing-credential')
  assert.equal(calls.length, 0)
})

test('rejects invalid quota payloads', async (t) => {
  mockFetch(t, {})
  const ctx = createCtx({ HF_TOKEN: 'hf-test-token' })

  await assert.rejects(() => read(ctx, ROUTE), /invalid quota response/)
})

test('reports usage counts without a money amount when rows have none', async (t) => {
  mockFetch(t, {
    usage: [{ provider: 'hf-inference', requestCount: 7, inputTokens: 500, outputTokens: 250 }],
    creditsRemaining: 1.5,
  })
  const ctx = createCtx({ HF_TOKEN: 'hf-test-token' })

  const data = await read(ctx, ROUTE)

  assert.equal(data.ok, true)
  assert.equal(data.kind, 'huggingface')
  assert.equal(data.usageOnly, true)
  assert.equal(data.usedAmount, undefined)
  assert.equal(data.requestCount, 7)
  assert.equal(data.inputTokens, 500)
  assert.equal(data.outputTokens, 250)
  assert.equal(data.creditsRemaining, '1.5')
})
