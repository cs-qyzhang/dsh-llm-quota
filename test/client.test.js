import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { builtinProviders, createProviderRegistry } from '../providers/index.js'
import { present } from '../providers/presentation.js'

const providerRegistry = createProviderRegistry({ plugins: builtinProviders() })
const providerManifest = providerRegistry.manifest()
const messages = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8')).messages

function loadClient(react) {
  let factory
  const context = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          factory = definition.factory
        },
      },
    },
    URLSearchParams,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    navigator: { language: 'en' },
    setInterval,
    clearInterval,
  }
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, context)
  const plugin = factory((id) => {
    if (id === 'react') return react ?? { createElement: () => ({}) }
    if (id === 'react-dom') return {}
    throw new Error(`Unexpected module: ${id}`)
  })
  return { context, plugin }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('normalizes history ranges to one hour', () => {
  const { plugin } = loadClient()
  for (const range of ['1h', '4h', '12h', '1d', '7d', '30d']) {
    assert.equal(plugin.__test.normalizeHistoryRange(range), range)
  }
  for (const range of [undefined, null, '', '24h', 4]) {
    assert.equal(plugin.__test.normalizeHistoryRange(range), '1h')
  }
})

test('builds explicit and initial history requests', async (t) => {
  const { context, plugin } = loadClient()
  const urls = []
  context.fetch = async (url, options) => {
    urls.push({ url, accept: options.headers.Accept })
    return { ok: true, json: async () => ({ ok: true, points: [], historyDefaultRange: '1h' }) }
  }
  t.after(() => { delete context.fetch })
  await plugin.__test.requestQuotaHistory('provider / test', '4h')
  await plugin.__test.requestQuotaHistory('', '30d')
  await plugin.__test.requestQuotaHistory('', null)
  await plugin.__test.requestQuotaHistory('', 'invalid')
  assert.deepEqual(urls, [
    { url: '/api/llm-quota/history?hours=4&provider=provider+%2F+test', accept: 'application/json' },
    { url: '/api/llm-quota/history?days=30', accept: 'application/json' },
    { url: '/api/llm-quota/history?', accept: 'application/json' },
    { url: '/api/llm-quota/history?hours=1', accept: 'application/json' },
  ])
})

test('requests the message dictionaries from the i18n route', async (t) => {
  const { context, plugin } = loadClient()
  const urls = []
  context.fetch = async (url, options) => {
    urls.push({ url, accept: options.headers.Accept })
    return {
      ok: true,
      json: async () => ({ ok: true, dictionaries: { zh: { title: '标题' }, en: { title: 'Title' } } }),
    }
  }
  t.after(() => { delete context.fetch })
  const dictionaries = await plugin.__test.requestDictionaries()
  assert.deepEqual(urls, [{ url: '/api/llm-quota/i18n', accept: 'application/json' }])
  assert.deepEqual(dictionaries, { zh: { title: '标题' }, en: { title: 'Title' } })

  context.fetch = async () => ({ ok: true, json: async () => ({ ok: false }) })
  await assert.rejects(() => plugin.__test.requestDictionaries(), /invalid i18n response/)
  context.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) })
  await assert.rejects(() => plugin.__test.requestDictionaries(), /HTTP 500/)
})

test('uses one hour in old settings drafts and saves only a changed range', () => {
  const { plugin } = loadClient()
  const draft = plugin.__test.createSettingsDraft({ cacheSeconds: 10, history: false })
  assert.equal(draft.historyDefaultRange, '1h')
  assert.equal(draft.cacheSeconds, '10')
  assert.equal(draft.history, false)
  const snapshot = { value: { cacheSeconds: 30, history: true }, user: {} }
  const unchanged = plugin.__test.settingsOperations(plugin.__test.createSettingsDraft(), snapshot)
  assert.deepEqual(plain(unchanged), { ops: [] })
  const changed = plugin.__test.settingsOperations({ ...plugin.__test.createSettingsDraft(), historyDefaultRange: '30d' }, snapshot)
  assert.deepEqual(plain(changed), { ops: [{ op: 'set', path: ['historyDefaultRange'], value: '30d' }] })
  const invalid = plugin.__test.settingsOperations({ ...draft, historyDefaultRange: '24h' }, snapshot)
  assert.equal(invalid.error.key, 'historyDefaultRangeInvalid')
})

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const match = findNode(child, predicate)
    if (match) return match
  }
  return undefined
}

async function renderHistory(t, { configuredRange, manualRange }) {
  const states = []
  const refs = []
  const effects = []
  let cursor = 0
  let refCursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++
      if (!states[index]) states[index] = { value: initial }
      return [states[index].value, (value) => {
        states[index].value = typeof value === 'function' ? value(states[index].value) : value
      }]
    },
    useRef(initial) {
      const index = refCursor++
      if (!refs[index]) refs[index] = { current: initial }
      return refs[index]
    },
    useCallback: (callback) => callback,
    useEffect: (callback) => { effects.push(callback) },
  }
  const { context, plugin } = loadClient(react)
  context.setInterval = t.mock.fn(() => 1)
  context.clearInterval = t.mock.fn()
  const requests = []
  context.fetch = async (url) => {
    requests.push(url)
    return { ok: true, json: async () => ({ ok: true, points: [], historyDefaultRange: configuredRange }) }
  }
  const render = () => {
    cursor = 0
    refCursor = 0
    return plugin.__test.QuotaHistory({ provider: 'custom', tr: (key) => key })
  }
  const rangeSelect = (value) => findNode(value, (node) => node.type === 'select' && node.props['aria-label'] === 'historyTitle')
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  let dispose
  const runEffect = () => {
    dispose?.()
    dispose = effects.shift()()
  }
  let tree = render()
  assert.equal(rangeSelect(tree).props.value, '1h')
  runEffect()
  if (manualRange) {
    rangeSelect(tree).props.onChange({ target: { value: manualRange } })
    tree = render()
    runEffect()
  }
  await flush()
  tree = render()
  if (!manualRange && configuredRange !== '1h') {
    runEffect()
    await flush()
    tree = render()
  }
  assert.equal(rangeSelect(tree).props.value, manualRange ?? configuredRange)
  const expectedParameter = (manualRange ?? configuredRange).endsWith('d') ? 'days=' : 'hours='
  if (manualRange) {
    assert.equal(requests.length, 2)
    assert.ok(requests.at(-1).includes(expectedParameter), JSON.stringify(requests))
  } else {
    assert.equal(requests.length, configuredRange === '1h' ? 1 : 2)
  }
  dispose()
  assert.ok(context.clearInterval.mock.callCount() > 0)
}

test('history popup defaults to one hour and applies a custom range', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  await renderHistory(t, { configuredRange: '1h' })
  t.mock.timers.reset()
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  await renderHistory(t, { configuredRange: '30d' })
})

test('history popup preserves a manual selection during configuration load', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  await renderHistory(t, { configuredRange: '30d', manualRange: '1h' })
})

// ---------------------------------------------------------------------------
// Provider view characterization tests.
//
// A deterministic translator echoes the key plus JSON params, so expectations
// stay locale-independent. The matrix pins the current output of compactLabel,
// badgeText, panelTitle and errorLabel for every payload shape the provider
// adapters emit; the registry refactor must keep all of these identical.
// ---------------------------------------------------------------------------

function presented(data) {
  if (!data) return data
  const serviceKind = data.service === 'moonshot' || data.service === 'radius' ? data.service : undefined
  const plugin = providerRegistry.byKind.get(serviceKind ?? (data.kind === 'account-balance' ? 'account' : data.kind))
  return plugin ? { ...data, ...present(plugin, data) } : data
}

const echoTr = (key, params) => key + (params ? `:${JSON.stringify(params)}` : '')

function labels(data) {
  data = presented(data)
  const { plugin } = loadClient()
  plugin.__test.views.setManifest(providerManifest)
  const view = plugin.__test
  return {
    compact: view.compactLabel(data, echoTr),
    badge: view.badgeText(data, echoTr),
    title: view.panelTitle(data, echoTr),
    error: view.errorLabel(data, echoTr),
  }
}

function assertLabels(data, expected) {
  const actual = labels(data)
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, `${key} of ${JSON.stringify(data)}`)
  }
}

test('renders balance payloads across services', () => {
  const balance = {
    ok: true, kind: 'balance', service: 'deepseek', currency: 'CNY', amount: '12.5',
    wallets: [{ currency: 'CNY', balance: '10' }, { currency: 'USD', balance: '2.5' }],
    bonusWallets: [{ currency: 'CNY', balance: '2' }],
    cycleUsage: '3.2', available: true,
  }
  assertLabels(balance, {
    compact: 'balance:{"amount":"¥12.50"}',
    badge: '¥12.50',
    title: 'balanceTitle',
  })
  assertLabels({ ...balance, service: 'moonshot' }, { title: 'moonshotTitle' })
  assertLabels({ ...balance, service: 'radius' }, { title: 'Radius' })
  assertLabels({ ok: true, kind: 'balance', currency: 'USD', amount: '3' }, { title: 'balanceTitle' })
})

test('renders credits payloads with and without cycle fallback', () => {
  assertLabels({ ok: true, kind: 'openrouter', currency: 'USD', amount: '5', totalCredits: '10', totalUsage: '2.5' }, {
    compact: 'balance:{"amount":"$5.00"}', badge: '$5.00', title: 'OpenRouter',
  })
  assertLabels({ ok: true, kind: 'vercel-gateway', currency: 'USD', amount: '5' }, { title: 'Vercel AI Gateway' })
  assertLabels({ ok: true, kind: 'xai', currency: 'USD', amount: '25', cycleUsage: '3' }, {
    compact: 'balance:{"amount":"$25.00"}', badge: '$25.00', title: 'xAI',
  })
  assertLabels({ ok: true, kind: 'xai', currency: 'USD', cycleUsage: '3' }, {
    compact: 'usedMonth:{"amount":"$3.00"}', badge: '$3.00', title: 'xAI',
  })
  assertLabels({ ok: true, kind: 'cloudflare', currency: 'USD', amount: '9' }, { title: 'Cloudflare' })
})

test('renders usage payloads for every usage kind', () => {
  for (const kind of ['anthropic', 'baseten', 'fireworks', 'huggingface', 'together']) {
    assertLabels({ ok: true, kind, currency: 'USD', usedAmount: '12.34' }, {
      compact: 'usedMonth:{"amount":"$12.34"}', badge: '$12.34',
    })
  }
  assertLabels({ ok: true, kind: 'anthropic', currency: 'USD', usedAmount: '1' }, { title: 'Anthropic' })
  assertLabels({ ok: true, kind: 'openai', currency: 'USD', requestCount: 42 }, {
    compact: 'usedRequests:{"count":42}', badge: '42', title: 'OpenAI',
  })
  assertLabels({ ok: true, kind: 'baseten', currency: 'USD', usedAmount: '1' }, { title: 'Baseten' })
  assertLabels({ ok: true, kind: 'fireworks', currency: 'USD', usedAmount: '1' }, { title: 'Fireworks' })
  assertLabels({ ok: true, kind: 'huggingface', currency: 'USD', usedAmount: '1' }, { title: 'Hugging Face' })
  assertLabels({ ok: true, kind: 'together', currency: 'USD', usedAmount: '1' }, { title: 'Together AI' })
  assertLabels({ ok: true, kind: 'openai', currency: 'USD' }, { compact: 'error', badge: '' })
})

test('renders window-plan payloads for the default plan kinds', () => {
  const windows = { ok: true, kind: 'glm', fiveHour: { remainingPercent: 40 }, weekly: { remainingPercent: 60 } }
  assertLabels(windows, {
    compact: 'fiveHour:{"percent":40} · weekly:{"percent":60}',
    badge: 'badgeFiveHour:{"percent":40} · badgeWeekly:{"percent":60}',
    title: 'GLM',
  })
  assertLabels({ ...windows, level: 'lite' }, { title: 'GLM Lite' })
  assertLabels({ ok: true, kind: 'kimi', fiveHour: { remainingPercent: 40 } }, {
    compact: 'fiveHour:{"percent":40}', badge: 'badgeFiveHour:{"percent":40}', title: 'Kimi',
  })
  assertLabels({ ok: true, kind: 'minimax', model: 'abab6.5s', fiveHour: { remainingPercent: 1 } }, {
    title: 'MiniMax · abab6.5s',
  })
  assertLabels({ ok: true, kind: 'minimax', fiveHour: { remainingPercent: 1 } }, { title: 'MiniMax' })
  assertLabels({ ok: true, kind: 'openai-codex', fiveHour: { remainingPercent: 1 } }, { title: 'OpenAI Codex' })
  // monthly participates in neither compact nor badge (E2).
  assertLabels({
    ok: true, kind: 'opencode-go',
    fiveHour: { remainingPercent: 20 }, weekly: { remainingPercent: 50 }, monthly: { remainingPercent: 90 },
  }, {
    compact: 'fiveHour:{"percent":20} · weekly:{"percent":50}',
    badge: 'badgeFiveHour:{"percent":20} · badgeWeekly:{"percent":50}',
    title: 'OpenCode Go',
  })
})

test('renders qwen and copilot plan payloads including guard asymmetries', () => {
  assertLabels({ ok: true, kind: 'qwen', plan: { remainingPercent: 55 } }, {
    compact: 'qwenPlanLeft:{"percent":55}', badge: 'badgePlan:{"percent":55}',
    title: 'qwenTitle · qwenTokenPlan',
  })
  assertLabels({ ok: true, kind: 'qwen' }, { compact: 'error', badge: '' })
  assertLabels({ ok: true, kind: 'qwen', plan: { remainingPercent: Number.NaN } }, { compact: 'error', badge: '' })
  const copilot = {
    ok: true, kind: 'github-copilot', planName: 'Pro',
    plan: { remainingPercent: 30 }, chat: { remainingPercent: 80 },
  }
  assertLabels(copilot, {
    compact: 'planLeft:{"percent":30}', badge: 'badgePlan:{"percent":30}', title: 'GitHub Copilot · Pro',
  })
  assertLabels({ ok: true, kind: 'github-copilot', plan: { remainingPercent: 30 } }, {
    title: 'GitHub Copilot', compact: 'planLeft:{"percent":30}',
  })
  assertLabels({ ok: true, kind: 'github-copilot' }, { compact: 'error', badge: '' })
})

test('renders xiaomi mimo balance, plan and hybrid modes', () => {
  assertLabels({ ok: true, kind: 'xiaomi-mimo', mode: 'balance', currency: 'CNY', amount: '5' }, {
    compact: 'balance:{"amount":"¥5.00"}', badge: '¥5.00', title: 'mimoTitle · mimoPayg',
  })
  assertLabels({
    ok: true, kind: 'xiaomi-mimo', mode: 'plan', plan: { name: 'Pro', remainingPercent: 70, used: 10, limit: 100 },
  }, {
    compact: 'mimoPlanLeft:{"percent":70}', badge: 'badgePlan:{"percent":70}',
    title: 'mimoTitle · mimoTokenPlan (Pro)',
  })
  assertLabels({ ok: true, kind: 'xiaomi-mimo', mode: 'plan', plan: { remainingPercent: 70 } }, {
    title: 'mimoTitle · mimoTokenPlan',
  })
  assertLabels({
    ok: true, kind: 'xiaomi-mimo', currency: 'CNY', amount: '5', plan: { name: 'Pro', remainingPercent: 70 },
  }, {
    compact: 'balance:{"amount":"¥5.00"} · mimoPlanLeft:{"percent":70}',
    badge: '¥5.00 · badgePlan:{"percent":70}',
    title: 'mimoTitle · Pro',
  })
  assertLabels({ ok: true, kind: 'xiaomi-mimo' }, { compact: 'error', badge: '', title: 'mimoTitle' })
})

test('falls back to plan windows and coin title for unknown kinds', () => {
  assertLabels({
    ok: true, kind: 'custom-kind',
    fiveHour: { remainingPercent: 20 }, weekly: { remainingPercent: 50 }, monthly: { remainingPercent: 80 },
  }, {
    compact: 'fiveHour:{"percent":20} · weekly:{"percent":50}',
    badge: 'badgeFiveHour:{"percent":20} · badgeWeekly:{"percent":50}',
    title: 'balanceTitle',
  })
})

test('gates failed and stale payloads per surface', () => {
  assertLabels({ ok: false, kind: 'glm', reason: 'missing-credential' }, {
    compact: 'error', badge: '', title: 'title', error: 'missingCredential',
  })
  // ok undefined still renders compact/title but not the badge (E4).
  assertLabels({ kind: 'glm', fiveHour: { remainingPercent: 20 } }, {
    compact: 'fiveHour:{"percent":20}', badge: '', title: 'GLM',
  })
  assertLabels(null, { compact: 'error', badge: '', title: 'title', error: 'error' })
  for (const [kind, label] of [
    ['anthropic', 'missingAdminKey'],
    ['openai', 'missingAdminKey'],
    ['github-copilot', 'missingGitHubToken'],
    ['openai-codex', 'missingCodexToken'],
    ['cloudflare', 'missingCloudflareCredential'],
    ['glm', 'missingCredential'],
  ]) {
    assert.equal(labels({ ok: false, kind, reason: 'missing-credential' }).error, label, kind)
  }
  assert.equal(labels({ ok: false, kind: 'xiaomi-mimo', reason: 'missing-cookie' }).error, 'missingCookie')
  assert.equal(labels({ ok: false, kind: 'qwen', reason: 'missing-console-token' }).error, 'missingConsoleToken')
  assert.equal(labels({ ok: false, kind: 'xai', reason: 'missing-management-key' }).error, 'missingManagementKey')
  assert.equal(labels({ ok: false, kind: 'account-balance', reason: 'signed-out' }).error, 'signedOut')
  assert.equal(labels({ ok: false, kind: 'openai', reason: 'error' }).error, 'error')
})

function rowSpecs(data) {
  const { plugin } = loadClient()
  plugin.__test.views.setManifest(providerManifest)
  return plain(plugin.__test.rowSpecsOf(presented(data), echoTr))
}

test('builds balance detail rows from wallets and status', () => {
  assert.deepEqual(rowSpecs({
    ok: true, kind: 'balance', currency: 'CNY',
    wallets: [{ currency: 'CNY', balance: '10' }, { currency: 'USD', balance: '2.5' }],
    bonusWallets: [{ currency: 'CNY', balance: '2' }, { currency: 'CNY', balance: '0' }],
    cycleUsage: '3.2', available: true,
  }), [
    { label: 'toppedUp', value: '¥10.00' },
    { label: 'toppedUp', value: '$2.50' },
    { label: 'bonus', value: '¥2.00' },
    { label: 'cycleUsage', value: '¥3.20' },
    { label: 'status', value: 'available' },
  ])
  assert.deepEqual(rowSpecs({ ok: true, kind: 'balance', available: false }), [
    { label: 'status', value: 'insufficient' },
  ])
})

test('builds credits rows for gateways and cycle-spend consoles', () => {
  assert.deepEqual(rowSpecs({
    ok: true, kind: 'openrouter', currency: 'USD', amount: '5', totalCredits: '10', totalUsage: '2.5',
  }), [
    { label: 'creditsRemaining', value: '$5.00' },
    { label: 'creditsPurchased', value: '$10.00' },
    { label: 'creditsUsed', value: '$2.50' },
  ])
  assert.deepEqual(rowSpecs({ ok: true, kind: 'vercel-gateway', currency: 'USD', amount: '5' }), [
    { label: 'creditsRemaining', value: '$5.00' },
  ])
  assert.deepEqual(rowSpecs({ ok: true, kind: 'xai', currency: 'USD', amount: '25', cycleUsage: '3' }), [
    { label: 'creditsRemaining', value: '$25.00' },
    { label: 'cycleUsage', value: '$3.00' },
  ])
  assert.deepEqual(rowSpecs({ ok: true, kind: 'cloudflare', currency: 'USD', amount: '9' }), [
    { label: 'creditsRemaining', value: '$9.00' },
  ])
})

test('builds usage rows including requests, tokens and credits', () => {
  assert.deepEqual(rowSpecs({
    ok: true, kind: 'openai', currency: 'USD', usedAmount: '12.34', requestCount: 42,
    inputTokens: 100, outputTokens: 200,
  }), [
    { label: 'usedMonthName', value: '$12.34' },
    { label: 'requestCountName', value: '42' },
    { label: 'tokenUsage', value: '100 / 200' },
  ])
  assert.deepEqual(rowSpecs({
    ok: true, kind: 'baseten', currency: 'USD', usedAmount: '1', creditsAmount: '0.5', chargedAmount: '0.5',
  }), [
    { label: 'usedMonthName', value: '$1.00' },
    { label: 'creditsApplied', value: '$0.50' },
    { label: 'chargedAmount', value: '$0.50' },
  ])
  // Zero credits suppress the charged-amount pair.
  assert.deepEqual(rowSpecs({
    ok: true, kind: 'baseten', currency: 'USD', usedAmount: '1', creditsAmount: '0', chargedAmount: '1',
  }), [
    { label: 'usedMonthName', value: '$1.00' },
  ])
})

test('builds plan rows for window kinds with reset notes', () => {
  const soon = new Date(Date.now() + 3_660_000).toISOString()
  assert.deepEqual(rowSpecs({
    ok: true, kind: 'opencode-go',
    fiveHour: { remainingPercent: 20 }, weekly: { remainingPercent: 50, resetAt: soon }, monthly: { remainingPercent: 90 },
  }), [
    { label: 'fiveHourName', value: 'remaining:{"percent":20}' },
    { label: 'weeklyName', value: 'remaining:{"percent":50}', note: 'resetsIn:{"time":"1h 1m"}' },
    { label: 'monthlyName', value: 'remaining:{"percent":90}' },
  ])
  assert.deepEqual(rowSpecs({ ok: true, kind: 'glm', fiveHour: { remainingPercent: 40 } }), [
    { label: 'fiveHourName', value: 'remaining:{"percent":40}' },
  ])
})

test('builds qwen, copilot and mimo plan rows', () => {
  assert.deepEqual(rowSpecs({ ok: true, kind: 'qwen', plan: { remainingPercent: 55 } }), [
    { label: 'qwenMonthly', value: 'remaining:{"percent":55}' },
  ])
  assert.deepEqual(rowSpecs({
    ok: true, kind: 'github-copilot', plan: { remainingPercent: 30 }, chat: { remainingPercent: 80 },
  }), [
    { label: 'copilotPremium', value: 'remaining:{"percent":30}' },
    { label: 'copilotChat', value: 'remaining:{"percent":80}' },
  ])
  assert.deepEqual(rowSpecs({
    ok: true, kind: 'xiaomi-mimo', currency: 'CNY', amount: '5', cashBalance: '4',
    giftBalance: '0', frozenBalance: '1',
    plan: {
      remainingPercent: 70, usedPercent: 30, used: 10, limit: 100,
      month: { remainingPercent: 60 }, compensation: { remainingPercent: 5 },
    },
  }), [
    { label: 'mimoBalance', value: '¥5.00' },
    { label: 'mimoCash', value: '¥4.00' },
    { label: 'mimoFrozen', value: '¥1.00' },
    { label: 'mimoPlan', value: 'mimoUsed:{"used":"10","limit":"100","percent":30}' },
    { label: 'mimoMonth', value: 'remaining:{"percent":60}' },
    { label: 'mimoCompensation', value: 'remaining:{"percent":5}' },
  ])
})

test('expands relative reset params instead of stringifying objects', () => {
  // A real locale translator only interpolates params with String(); a
  // structured `{ relative }` param must be formatted before it reaches tr().
  const literalTr = (key, params) => {
    const template = messages[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
  }
  const { plugin } = loadClient()
  plugin.__test.views.setManifest(providerManifest)
  const far = new Date(Date.now() + 5 * 86_400_000).toISOString()
  const rows = plain(plugin.__test.rowSpecsOf(presented({
    ok: true, kind: 'github-copilot', plan: { remainingPercent: 30, resetAt: far }, chat: { remainingPercent: 80 },
  }), literalTr))
  const note = rows[0].note
  assert.ok(note, 'reset note should be present')
  assert.ok(!note.includes('[object Object]'), note)
  assert.match(note, /^Resets /)
  assert.ok(!Number.isNaN(Date.parse(far)))
})

test('resolves the gauge icon per kind and payload', () => {
  const { plugin } = loadClient()
  plugin.__test.views.setManifest(providerManifest)
  const gauge = plugin.__test.providerGauge
  for (const kind of ['glm', 'kimi', 'minimax', 'qwen', 'github-copilot', 'opencode-go', 'openai-codex']) {
    assert.equal(gauge(presented({ ok: true, kind })), true, kind)
  }
  // Failure payloads keep their kind's icon.
  assert.equal(gauge(presented({ ok: false, kind: 'glm', reason: 'missing-credential' })), true)
  for (const kind of ['balance', 'openrouter', 'vercel-gateway', 'xai', 'cloudflare', 'anthropic', 'openai']) {
    assert.equal(gauge({ ok: true, kind }), false, kind)
  }
  for (const [kind, data] of [
    ['xiaomi-mimo', { mode: 'balance', amount: '1', currency: 'CNY' }],
    ['xiaomi-mimo', { mode: 'plan', plan: { remainingPercent: 80 } }],
    ['xiaomi-mimo', {}],
  ]) assert.equal(gauge(presented({ ok: true, kind, ...data })), data.mode === 'balance' ? false : true)
  assert.equal(gauge({ ok: true, kind: 'custom-kind' }), false)
  assert.equal(gauge(null), false)
})

test('uses provider-supplied translations, error views, and structured rows', () => {
  const views = loadClient().plugin.__test.createViewEngine()
  views.setLanguage('zh-CN')
  views.setManifest({
    messages: { zh: { customTitle: '自定义余额', customDenied: '凭证已失效', customValue: '余额 {amount}' } },
    views: {
      custom: {
        preset: 'balance', title: { key: 'customTitle' },
        errors: { denied: { key: 'customDenied' } },
      },
    },
  })
  const data = { ok: true, kind: 'custom', currency: 'CNY', amount: '1' }
  assert.equal(views.panelTitle(data, (key) => key), '自定义余额')
  assert.equal(views.errorLabel({ ok: false, kind: 'custom', reason: 'denied' }, (key) => key), '凭证已失效')
  assert.deepEqual(plain(views.rowSpecsOf({ ...data, view: { rows: [{ label: { key: 'customValue', params: { amount: '1' } }, value: { key: 'customTitle' } }] } }, (key) => key)), [
    { label: '余额 1', value: '自定义余额' },
  ])
})

test('falls back by payload shape when the manifest is unavailable', () => {
  const views = loadClient().plugin.__test.createViewEngine()
  assert.equal(views.compactLabel({ ok: true, kind: 'custom', currency: 'USD', amount: '2' }, echoTr), 'balance:{"amount":"$2.00"}')
  assert.equal(views.compactLabel({ ok: true, kind: 'custom', usedAmount: '2' }, echoTr), 'usedMonth:{"amount":"2.00"}')
  assert.equal(views.errorLabel({ ok: false, kind: 'custom', reason: 'denied' }, echoTr), 'error')
})

test('falls back to a generic view for unknown kinds and ships well-formed provider manifests', async () => {
  await providerRegistry.ready
  const { plugin } = loadClient()
  const { viewOf } = plugin.__test
  const fallback = viewOf({ kind: 'custom-kind' })
  assert.equal(fallback.preset, 'plan')
  assert.equal(fallback.gauge, false)
  const kinds = Object.keys(providerManifest.views).sort()
  assert.deepEqual(kinds, [
    'account', 'anthropic', 'baseten', 'cloudflare', 'deepseek', 'fireworks', 'github-copilot', 'glm',
    'huggingface', 'kimi', 'minimax', 'moonshot', 'openai', 'openai-codex', 'opencode-go', 'openrouter',
    'qwen', 'radius', 'together', 'vercel-gateway', 'xai', 'xiaomi-mimo',
  ])
  for (const [kind, entry] of Object.entries(providerManifest.views)) {
    assert.ok(['balance', 'credits', 'usage', 'plan'].includes(entry.preset), `${kind} preset`)
    assert.ok(entry.title, `${kind} title`)
  }
  assert.equal(providerManifest.views['openai'].credentials, undefined)
  assert.equal(providerManifest.views['openai'].messages, undefined)
  assert.ok(providerManifest.credentials.some((row) => row.id === 'admin-key'))
})

test('falls back for an empty provider view and translates custom credential fields', () => {
  const engine = loadClient().plugin.__test.createViewEngine()
  engine.setLanguage('zh')
  engine.setManifest({
    views: {},
    messages: { zh: { credentialLabel: '自定义凭证' } },
    credentials: [{ id: 'custom', label: { key: 'credentialLabel' } }],
  })
  const data = { ok: true, viewId: 'custom', view: {}, currency: 'USD', amount: '12.5' }
  assert.equal(engine.badgeText(data, echoTr), '$12.50')
  assert.equal(engine.compactLabel(data, echoTr), 'balance:{"amount":"$12.50"}')
  assert.equal(engine.text(engine.credentialRows()[0].label, echoTr), '自定义凭证')
})

test('stops tracking model providers when the last provider node disappears', async (t) => {
  const { context, plugin } = loadClient()
  const nodes = [{ getAttribute: () => 'kimi-coding' }]
  context.document = {
    head: { appendChild() {} },
    body: {},
    createElement: () => ({ dataset: {}, remove() {} }),
    querySelectorAll: () => nodes,
  }
  context.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  const requests = []
  context.fetch = async () => {
    requests.push('request')
    return { ok: true, json: async () => ({ ok: true, kind: 'kimi', fiveHour: { remainingPercent: 75 } }) }
  }
  t.after(() => { delete context.document; delete context.MutationObserver; delete context.fetch })
  let state
  const dispose = plugin.__test.installModelBadges(undefined, (key) => key, (hooks) => { state = hooks })
  assert.equal(state.feed.size, 1)
  nodes.length = 0
  state.scan()
  assert.equal(state.feed.size, 0)
  const before = requests.length
  state.scan()
  assert.equal(requests.length, before)
  dispose()
})

test('times out a hanging dictionary request and retries after the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const { context, plugin } = loadClient()
  const effects = []
  const ctx = {
    locale: { register: () => () => {} },
    effect(callback) { effects.push(callback) },
    slots: { inject() {} },
    inject() {},
  }
  const requests = []
  context.fetch = (url, options) => {
    if (url !== '/api/llm-quota/i18n') return Promise.resolve({ ok: true, json: async () => ({ ok: true, views: {} }) })
    requests.push(options.signal)
    if (requests.length > 1) return Promise.resolve({ ok: true, json: async () => ({ ok: true, dictionaries: {} }) })
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  }
  t.after(() => { delete context.fetch })
  plugin.apply(ctx)
  effects[1]()
  assert.equal(requests.length, 1)
  t.mock.timers.tick(8_000)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests[0].aborted, true)
  t.mock.timers.tick(30_000)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.length, 2)
})
