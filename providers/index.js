/**
 * Provider adapter registry.
 *
 * To support a new quota system:
 *   1. Add a module in this directory exporting `kind`, `hosts` (HTTPS hostname
 *      -> fixed quota endpoint), and `read(ctx, route)`.
 *   2. Add it to `ADAPTERS` below.
 *   3. If its credentials/baseURL live in a new DSH plugin, add a branch in
 *      `resolve.js`.
 *
 * Explicit `config.providers` overrides pick an adapter by `kind`, so any
 * registered kind can also be pointed at a custom endpoint.
 */

import * as account from './account.js'
import * as anthropic from './anthropic.js'
import * as baseten from './baseten.js'
import * as cloudflare from './cloudflare.js'
import * as deepseek from './deepseek.js'
import * as fireworks from './fireworks.js'
import * as githubCopilot from './github-copilot.js'
import * as glm from './glm.js'
import * as huggingface from './huggingface.js'
import * as kimi from './kimi.js'
import * as minimax from './minimax.js'
import * as moonshot from './moonshot.js'
import * as openai from './openai.js'
import * as openaiCodex from './openai-codex.js'
import * as opencodeGo from './opencode-go.js'
import * as openrouter from './openrouter.js'
import * as qwen from './qwen.js'
import * as radius from './radius.js'
import * as together from './together.js'
import * as vercelGateway from './vercel-gateway.js'
import * as xai from './xai.js'
import * as xiaomiMimo from './xiaomi-mimo.js'
import { withCacheKey } from './shared.js'

const ADAPTERS = [
  account,
  anthropic,
  baseten,
  cloudflare,
  deepseek,
  fireworks,
  githubCopilot,
  glm,
  huggingface,
  kimi,
  minimax,
  moonshot,
  openai,
  openaiCodex,
  opencodeGo,
  openrouter,
  qwen,
  radius,
  together,
  vercelGateway,
  xai,
  xiaomiMimo,
]

const ADAPTER_BY_KIND = new Map(ADAPTERS.map((adapter) => [adapter.kind, adapter]))

const ADAPTER_BY_HOST = new Map()
for (const adapter of ADAPTERS) {
  for (const [hostname, endpoint] of Object.entries(adapter.hosts ?? {})) {
    ADAPTER_BY_HOST.set(hostname, { kind: adapter.kind, endpoint })
  }
}

export function routeFromBaseURL(provider, baseURL, keyNames) {
  if (typeof baseURL !== 'string') return { provider, reason: 'unavailable' }
  let hostname
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    hostname = url.hostname
  } catch {
    return { provider, reason: 'unavailable' }
  }
  const adapter = ADAPTER_BY_HOST.get(hostname)
  if (!adapter) return undefined
  return withCacheKey({ provider, ...adapter, keyNames })
}

export async function readQuota(ctx, route) {
  const adapter = ADAPTER_BY_KIND.get(route.kind)
  if (!adapter) return { ok: false, provider: route.provider, reason: 'unsupported' }
  return adapter.read(ctx, route)
}
