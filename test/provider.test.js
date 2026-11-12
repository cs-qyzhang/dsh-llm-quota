import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defineProvider } from '../provider.js'
import { builtinProviders } from '../providers/index.js'
import { createProviderRegistry } from '../providers/registry.js'
import { readQuota, routeFromBaseURL } from '../providers/runtime.js'

const context = {
  credentials: { resolve: async () => ({ value: 'secret' }) },
  get(name) { return name === 'exampleService' ? { value: 42 } : undefined },
}

test('normalizes provider identity and time at the Host boundary', async () => {
  const plugin = defineProvider({
    kind: 'example', services: ['exampleService'],
    async read({ route, credentials, services }) {
      assert.equal(route.provider, 'actual')
      assert.equal(await credentials.resolve(['KEY']), 'secret')
      assert.equal(services.exampleService.value, 42)
      return { provider: 'ignored', kind: 'balance', updatedAt: 'invalid', amount: '12.5' }
    },
  })
  const value = await plugin.read(context, { provider: 'actual', kind: 'example' })
  assert.equal(value.ok, true)
  assert.equal(value.provider, 'actual')
  assert.equal(value.kind, 'balance')
  assert.equal(value.amount, '12.5')
  assert.ok(Number.isFinite(Date.parse(value.updatedAt)))
  assert.equal(value.viewId, 'example')
  await assert.rejects(() => defineProvider({ kind: 'invalid', read() {} }).read(context, {}), /invalid provider result/)
  await assert.rejects(() => defineProvider({ kind: 'invalid', read: () => [] }).read(context, {}), /invalid provider result/)
})

test('normalizes terminal failures from reason and supplies their views', async () => {
  const plugin = defineProvider({ kind: 'example', read: () => ({ ok: true, reason: 'missing-credential' }), view: { preset: 'balance', title: 'Example' } })
  const value = await plugin.read(context, { provider: 'actual', kind: 'example' })
  assert.equal(value.ok, false)
  assert.equal(value.reason, 'missing-credential')
  assert.equal(value.viewId, 'example')
  assert.equal(value.view.title, undefined)
})

test('keeps an explicit ok: false result a failure', async () => {
  const plugin = defineProvider({ kind: 'example', read: () => ({ ok: false, amount: '12.5' }) })
  const value = await plugin.read(context, { provider: 'actual', kind: 'example' })
  assert.equal(value.ok, false)
})

test('registry loads only explicit provider exports and publishes custom messages', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'quota-provider-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'custom.mjs')
  await writeFile(file, `
    export const providers = [{ kind: 'custom', read: () => ({ amount: '1' }), view: {
      preset: 'balance', title: { key: 'customTitle' }, messages: { en: { customTitle: 'Custom balance' } },
    } }]
    export const helper = 'not a provider'
  `)
  const registry = createProviderRegistry({ modules: [file] })
  await registry.ready
  assert.equal(registry.manifest().views.custom.title.key, 'customTitle')
  assert.equal(registry.manifest().messages.en.customTitle, 'Custom balance')
  const value = await readQuota(registry, context, { provider: 'alias', kind: 'custom' })
  assert.equal(value.ok, true)
  assert.equal(value.provider, 'alias')
  assert.equal(routeFromBaseURL(registry, 'alias', 'http://insecure.example', ['KEY']), undefined)
  assert.deepEqual(routeFromBaseURL(registry, 'alias', undefined, []), { provider: 'alias', reason: 'unavailable' })
})

test('a broken provider module resolves without crashing and exposes readyError', async () => {
  const registry = createProviderRegistry({ modules: ['./missing-provider-module.js'] })
  await registry.ready
  assert.ok(registry.readyError instanceof Error)
  assert.match(registry.readyError.message, /missing-provider-module/)
  assert.deepEqual(registry.ordered, [])
})

test('historySpec merges preset metrics with the provider view', () => {
  const registry = createProviderRegistry({ plugins: builtinProviders() })
  // `kimi` only declares plan windows on the shared plan preset.
  const spec = registry.historySpec({ provider: 'kimi-coding', kind: 'kimi' })
  assert.deepEqual(spec.map((metric) => metric.key), ['fiveHour', 'weekly', 'monthly'])
  // `github-copilot` adds a `chat` metric on top of the preset.
  const copilot = registry.historySpec({ provider: 'copilot', kind: 'github-copilot' })
  assert.deepEqual(copilot.map((metric) => metric.key), ['plan', 'chat'])
  assert.equal(registry.historySpec({ provider: 'unknown', kind: 'nope' }), undefined)
})
