import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const LOCALE_DIR = new URL('../locale/', import.meta.url)
// Every language dsh itself ships (@deepseek-ai/dsh-client-locale).
export const DSH_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh']

const locales = new Map(
  readdirSync(LOCALE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name.slice(0, -5), JSON.parse(readFileSync(new URL(name, LOCALE_DIR), 'utf8'))]),
)
const en = locales.get('en')
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const providerSources = readdirSync(new URL('../providers/', import.meta.url))
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(new URL(`../providers/${name}`, import.meta.url), 'utf8'))
const sources = [client, ...providerSources].join('\n')

function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

test('ships a dictionary for every language dsh supports', () => {
  for (const language of DSH_LANGUAGES) {
    assert.ok(locales.has(language), `locale/${language}.json is missing`)
  }
})

test('every locale file carries meta and messages', () => {
  for (const [name, file] of locales) {
    assert.equal(typeof file.meta?.title, 'string', `${name}: meta.title`)
    assert.ok(file.meta.title.trim() !== '', `${name}: meta.title is empty`)
    assert.equal(typeof file.meta?.description, 'string', `${name}: meta.description`)
    assert.ok(file.meta.description.trim() !== '', `${name}: meta.description is empty`)
    assert.ok(file.messages && typeof file.messages === 'object', `${name}: messages`)
    for (const [key, value] of Object.entries(file.messages)) {
      assert.equal(typeof value, 'string', `${name}: messages.${key}`)
      assert.ok(value.trim() !== '', `${name}: messages.${key} is empty`)
    }
  }
})

test('every locale defines the same keys with the same placeholders as en', () => {
  const enKeys = Object.keys(en.messages).sort()
  for (const [name, file] of locales) {
    assert.deepEqual(Object.keys(file.messages).sort(), enKeys, `${name}: message keys differ from en`)
    for (const key of enKeys) {
      assert.deepEqual(
        placeholders(file.messages[key]),
        placeholders(en.messages[key]),
        `${name}: messages.${key} placeholders differ`,
      )
    }
  }
})

test('every message key is referenced by the Client or a Provider (no dead keys)', () => {
  for (const key of Object.keys(en.messages)) {
    assert.ok(sources.includes(`'${key}'`), `messages.${key} is never referenced`)
  }
})

test('every translate call in client.js resolves to a message key (no missing keys)', () => {
  for (const match of client.matchAll(/\b(?:tr|t)\('([A-Za-z0-9]+)'/g)) {
    const key = match[1]
    for (const [name, file] of locales) {
      assert.ok(
        Object.hasOwn(file.messages, key),
        `client.js translates '${key}' but locale/${name}.json does not define it`,
      )
    }
  }
})

test('every camelCase literal in client.js is a message key (dynamic keys cannot drift)', () => {
  // Error keys, notices, range labels, and metric labels reach `tr` through
  // variables; their literals are the only source of truth we can check.
  const nonKeyLiterals = new Set([
    'xAI', // brand name (TITLES)
    'currentColor', // CSS value
    'usedAmount', // history metric field name
    'modelSelection', // projection name
  ])
  for (const match of client.matchAll(/'([a-z][A-Za-z0-9]+)'/g)) {
    const literal = match[1]
    if (!/[A-Z]/.test(literal) || nonKeyLiterals.has(literal)) continue
    for (const [name, file] of locales) {
      assert.ok(
        Object.hasOwn(file.messages, literal),
        `client.js uses '${literal}' where a message key is expected, but locale/${name}.json does not define it`,
      )
    }
  }
})

test('client.js keeps no user-facing copy outside the locale files', () => {
  assert.doesNotMatch(client, /[\u4e00-\u9fff]/, 'client.js contains CJK text; move it into locale/*.json')
})
