import { routeFromBaseURL } from './runtime.js'
import { withCacheKey } from './shared.js'

function valueOf(value) {
  return value && typeof value.get === 'function' ? value.get() : value
}

function configAt(config, path) {
  if (!path?.length) {
    return Object.fromEntries(Object.entries(config ?? {}).map(([key, value]) => [key, valueOf(value)]))
  }
  let value = valueOf(config)
  for (const key of path) value = valueOf(value)?.[key]
  return valueOf(value)
}

export async function resolveRoute(ctx, provider, overrides, registry) {
  if (!provider) return undefined
  // Explicit `config.providers` entries win over everything else, including the
  // builtin `matchProvider` adapters (see docs/providers.md resolution order).
  if (overrides && Object.hasOwn(overrides, provider)) {
    const custom = overrides[provider]
    if (!custom || typeof custom !== 'object') return undefined
    const plugin = registry.byKind.get(custom.kind)
    if (!plugin) return undefined
    const override = { ...custom, provider }
    return withCacheKey(plugin.normalizeOverride?.({ override, provider }) ?? override)
  }
  for (const plugin of registry.ordered) {
    if (plugin.matchProvider?.(provider)) return withCacheKey({ provider, kind: plugin.kind })
  }

  if (!ctx.llm.listProviders().some((entry) => entry.id === provider)) return undefined
  const directory = ctx.llm.listConfigurableProviders().find((entry) => entry.provider === provider)
  if (!directory) return { provider, reason: 'unavailable' }
  const owner = [...ctx.loader.entries()].find((entry) => (
    entry.options.id === directory.settingsNs && entry.fiber?.state === 2
  ))
  if (!owner) return { provider, reason: 'unavailable' }

  const config = owner.fiber.effectiveConfig ?? owner.fiber.config
  const profile = configAt(config, directory.settingsPath)
  if (!profile || typeof profile !== 'object') return { provider, reason: 'unavailable' }
  const keyNames = profile.apiKeyEnv
    ? [profile.apiKeyEnv]
    : [...(directory.nativeAuth?.env ?? [])].filter((name) => typeof name === 'string' && name.length > 0)
  const context = {
    provider,
    directory,
    profile,
    inference: {
      baseURL: profile.baseURL ?? directory.defaultBaseURL,
      keyNames,
      oauth: directory.nativeAuth?.oauth === true,
    },
    services: Object.fromEntries(['launchEnvironment'].map((name) => [name, ctx.get(name)])),
  }

  for (const plugin of registry.ordered) {
    if (typeof plugin.route !== 'function') continue
    if (context.inference.oauth && context.inference.keyNames.length === 0 && !plugin.allowSpecialBeforeOAuth) continue
    const route = await plugin.route(context)
    if (route) return withCacheKey({ kind: plugin.kind, provider, ...route })
  }
  if (keyNames.length === 0 && context.inference.oauth) return undefined
  return routeFromBaseURL(registry, provider, context.inference.baseURL, keyNames)
}
