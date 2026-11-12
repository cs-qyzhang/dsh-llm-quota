import { defineProvider, readQuota, routeFromBaseURL } from './runtime.js'
import { createProviderRegistry } from './registry.js'
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

export { createProviderRegistry }

export function builtinProviders() {
  return [
    xiaomiMimo, qwen, xai, anthropic, openai, githubCopilot, openaiCodex, opencodeGo, cloudflare,
    account, deepseek, baseten, fireworks, glm, huggingface, kimi, minimax, moonshot, openrouter,
    radius, together, vercelGateway,
  ].map((adapter) => defineProvider(adapter))
}

export { readQuota, routeFromBaseURL }
