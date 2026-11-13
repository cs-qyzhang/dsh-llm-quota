import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineProvider, providerFailure } from '../provider.js'
import * as presets from './presets.js'

export function createProviderRegistry({ plugins = [], modules = [] } = {}) {
  const ordered = []
  const byKind = new Map()
  const byHost = new Map()

  function register(input) {
    const plugin = input?.[Symbol.for('dsh-llm-quota.provider')] === true ? input : defineProvider(input)
    if (byKind.has(plugin.kind)) throw new Error(`duplicate provider plugin: ${plugin.kind}`)
    byKind.set(plugin.kind, plugin)
    ordered.push(plugin)
    for (const [hostname, endpoint] of Object.entries(plugin.hosts ?? {})) {
      if (byHost.has(hostname)) throw new Error(`duplicate provider host: ${hostname}`)
      byHost.set(hostname, { kind: plugin.kind, endpoint })
    }
    return plugin
  }

  for (const plugin of plugins) register(plugin)
  let readyError
  const ready = (async () => {
    for (const specifier of modules) {
      if (typeof specifier !== 'string' || specifier.length === 0) throw new TypeError('provider module must be a non-empty string')
      const target = specifier.startsWith('.') || isAbsolute(specifier)
        ? pathToFileURL(isAbsolute(specifier) ? specifier : resolve(specifier)).href
        : specifier
      const module = await import(target)
      const candidates = module.default ?? module.providers ?? module.provider
      for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) register(candidate)
    }
  })().catch((error) => {
    // A broken provider module must not crash the Host with an unhandled
    // rejection; callers check `readyError` after awaiting `ready`.
    readyError = error
  })

  return {
    ordered,
    byKind,
    byHost,
    ready,
    get readyError() {
      return readyError
    },
    register,
    manifest() {
      const views = {}
      const credentials = new Map()
      const messages = {}
      const history = {}
      const historyPriority = []
      for (const plugin of ordered) {
        const view = { ...presets[plugin.view?.preset], ...plugin.view }
        delete view.credentials
        delete view.messages
        if (plugin.view) views[plugin.kind] = view
        for (const [language, entries] of Object.entries(plugin.view?.messages ?? {})) {
          messages[language] = { ...messages[language], ...entries }
        }
        for (const metric of view.history ?? []) {
          if (!history[metric.key]) history[metric.key] = { unit: metric.unit, label: metric.label }
          if (!historyPriority.includes(metric.key)) historyPriority.push(metric.key)
        }
        for (const credential of plugin.view?.credentials ?? []) {
          if (!credentials.has(credential.id)) credentials.set(credential.id, credential)
        }
      }
      return { views, messages, credentials: [...credentials.values()], history, historyPriority }
    },
    historySpec(route) {
      const plugin = byKind.get(route.kind)
      if (!plugin) return undefined
      return { ...presets[plugin.view?.preset], ...plugin.view }.history
    },
    failure(route, error) {
      const plugin = byKind.get(route.kind)
      if (!plugin) return {}
      // Public fields only: keyNames, cacheKey and endpoint stay on the Host.
      const result = { provider: route.provider, kind: route.kind, ok: false, reason: 'error', error: String(error?.message ?? error).slice(0, 300), updatedAt: new Date().toISOString() }
      return { ...result, ...providerFailure(plugin, result), viewId: plugin.kind }
    },
    routeFailure(route) {
      const plugin = byKind.get(route.kind)
      return plugin ? { ...providerFailure(plugin, route), viewId: plugin.kind } : {}
    },
  }
}
