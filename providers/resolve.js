/**
 * Resolve a provider id to a quota route using the live DSH configuration.
 *
 * This is the only place that knows about specific DSH provider plugins
 * (`llm-pi-ai` and `llm-deepseek-api-key`). A new plugin that stores its
 * credential reference or baseURL differently needs a branch here.
 */

import * as account from './account.js'
import * as anthropic from './anthropic.js'
import * as cloudflare from './cloudflare.js'
import * as githubCopilot from './github-copilot.js'
import * as openai from './openai.js'
import * as openaiCodex from './openai-codex.js'
import * as opencodeGo from './opencode-go.js'
import { routeFromBaseURL } from './index.js'
import { withCacheKey } from './shared.js'
import * as qwen from './qwen.js'
import * as xai from './xai.js'
import * as xiaomiMimo from './xiaomi-mimo.js'

const ACCOUNT_PROVIDER = 'deepseek-account'
const PI_AI_PACKAGE = '@deepseek-ai/dsh-llm-pi-ai'
const DEEPSEEK_API_KEY_PACKAGE = '@deepseek-ai/dsh-llm-deepseek-api-key'
const DEEPSEEK_OFFICIAL_PROVIDER = 'deepseek-official'
const DEEPSEEK_PUBLIC_BASE_URL = 'https://api.deepseek.com/anthropic'
const XIAOMI_HOST = 'xiaomimimo.com'

export function resolveRoute(ctx, provider, overrides) {
  if (!provider) return undefined
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, provider)) {
    const custom = overrides[provider]
    if (!custom || typeof custom !== 'object') return undefined
    const route = { ...custom, provider }
    if (route.kind === xiaomiMimo.kind && route.mode === undefined) {
      route.mode = xiaomiMimo.billingMode(provider)
    }
    if (route.kind === xai.kind && route.keyNames === undefined) {
      route.keyNames = xai.MANAGEMENT_KEY_NAMES
    }
    if (route.kind === qwen.kind && route.keyNames === undefined) {
      route.keyNames = qwen.TOKEN_NAMES
    }
    return withCacheKey(route)
  }
  if (provider === ACCOUNT_PROVIDER) return withCacheKey({ provider, kind: account.kind })
  if (!ctx.llm.listProviders().some((entry) => entry.id === provider)) return undefined

  const directory = ctx.llm.listConfigurableProviders().find((entry) => entry.provider === provider)
  if (!directory) return { provider, reason: 'unavailable' }
  const owner = [...ctx.loader.entries()].find((entry) => (
    entry.options.id === directory.settingsNs && entry.fiber?.state === 2
  ))
  if (!owner) return { provider, reason: 'unavailable' }

  if (owner.options.name === PI_AI_PACKAGE && directory.settingsPath[0] === 'providers') {
    const profile = owner.fiber.config.providers.get()?.[provider]
    if (!profile || typeof profile !== 'object') return { provider, reason: 'unavailable' }
    const baseURL = profile.baseURL ?? directory.defaultBaseURL
    if (isXiaomiMimoHost(baseURL)) {
      const cookieNames = profile.cookieEnv ? [profile.cookieEnv] : xiaomiMimo.COOKIE_NAMES
      return withCacheKey({
        provider,
        kind: xiaomiMimo.kind,
        mode: xiaomiMimo.billingMode(provider, baseURL),
        endpoint: xiaomiMimo.DEFAULT_ENDPOINT,
        keyNames: cookieNames,
      })
    }
    const qwenRoute = qwen.routeFor(baseURL)
    if (qwenRoute) {
      return withCacheKey({
        provider,
        kind: qwen.kind,
        ...qwenRoute,
        keyNames: qwen.TOKEN_NAMES,
      })
    }
    // xAI billing is read through the console Management Key, never the
    // inference key that the pi-ai profile resolves.
    const xaiRoute = xai.routeFor(baseURL)
    if (xaiRoute) {
      return withCacheKey({
        provider,
        kind: xai.kind,
        ...xaiRoute,
        keyNames: xai.MANAGEMENT_KEY_NAMES,
      })
    }
    const keyNames = profile.apiKeyEnv
      ? [profile.apiKeyEnv]
      : [...(directory.nativeAuth?.env ?? [])]

    // Quota for these providers is read through a dedicated credential (an
    // admin key, a GitHub token, a ChatGPT OAuth token, or an account-level
    // token), never the inference key, so resolve them even for OAuth-only
    // routes; without the credential the adapter reports what is missing.
    const anthropicRoute = anthropic.routeFor(baseURL)
    if (anthropicRoute) {
      return withCacheKey({ provider, kind: anthropic.kind, ...anthropicRoute })
    }
    const openaiRoute = openai.routeFor(baseURL)
    if (openaiRoute) {
      return withCacheKey({ provider, kind: openai.kind, ...openaiRoute })
    }
    const copilotRoute = githubCopilot.routeFor(baseURL)
    if (copilotRoute) {
      return withCacheKey({
        provider,
        kind: githubCopilot.kind,
        ...copilotRoute,
        keyNames: mergeNames(githubCopilot.KEY_NAMES, keyNames),
      })
    }
    const codexRoute = openaiCodex.routeFor(baseURL)
    if (codexRoute) {
      return withCacheKey({ provider, kind: openaiCodex.kind, ...codexRoute })
    }
    const goRoute = opencodeGo.routeFor(baseURL)
    if (goRoute) {
      return withCacheKey({
        provider,
        kind: opencodeGo.kind,
        ...goRoute,
        keyNames: mergeNames(opencodeGo.KEY_NAMES, keyNames),
      })
    }
    const cloudflareRoute = cloudflare.routeFor(baseURL)
    if (cloudflareRoute) {
      return withCacheKey({
        provider,
        kind: cloudflare.kind,
        ...cloudflareRoute,
        keyNames: mergeNames(cloudflare.KEY_NAMES, keyNames),
      })
    }

    if (keyNames.length === 0 && directory.nativeAuth?.oauth) return undefined
    return routeFromBaseURL(provider, baseURL, keyNames)
  }

  if (owner.options.name === DEEPSEEK_API_KEY_PACKAGE && provider === DEEPSEEK_OFFICIAL_PROVIDER) {
    const keyName = owner.fiber.config.apiKeyEnv.get()
    const baseURL = owner.fiber.config.baseURL.get()
      ?? ctx.get('launchEnvironment')?.get('DEEPSEEK_BASE_URL')?.value
      ?? DEEPSEEK_PUBLIC_BASE_URL
    return routeFromBaseURL(provider, baseURL, keyName ? [keyName] : [])
  }

  return { provider, reason: 'unavailable' }
}

function isXiaomiMimoHost(baseURL) {
  if (typeof baseURL !== 'string') return false
  try {
    const url = new URL(baseURL)
    return url.protocol === 'https:' && (url.hostname === XIAOMI_HOST || url.hostname.endsWith(`.${XIAOMI_HOST}`))
  } catch {
    return false
  }
}

/** Union of credential names, primary list first, without duplicates. */
function mergeNames(primary, fallback) {
  const names = []
  for (const name of [...primary, ...fallback]) {
    if (typeof name === 'string' && name.length > 0 && !names.includes(name)) names.push(name)
  }
  return names
}
