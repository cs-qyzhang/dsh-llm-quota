import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

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
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: async () => { throw new Error('fetch stub not configured') },
  }
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), context)
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
