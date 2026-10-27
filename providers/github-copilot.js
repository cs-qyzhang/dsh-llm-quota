/**
 * GitHub Copilot subscription quota (premium requests).
 *
 * Reads the same internal endpoint the VS Code Copilot extension uses
 * (`GET https://api.github.com/copilot_internal/user`) with a GitHub token
 * (`gho_`/`ghu_`/`ghp_` or a PAT). NOTE: this is an unofficial internal API,
 * so its shape or availability may change without notice; a 403/404 simply
 * surfaces as a transient error (no fallback here). The official REST
 * alternative is
 * `GET /users/{username}/settings/billing/premium_request/usage` (fine-grained
 * PAT with `Plan: read`), which is intentionally not implemented yet.
 */

import { clampPercent, fetchJson, nowIso, resolveKey, toIso, unavailable } from './shared.js'

export const kind = 'github-copilot'
export const DEFAULT_ENDPOINT = 'https://api.github.com/copilot_internal/user'

export const hosts = {
  'api.individual.githubcopilot.com': DEFAULT_ENDPOINT,
  'api.business.githubcopilot.com': DEFAULT_ENDPOINT,
  'api.enterprise.githubcopilot.com': DEFAULT_ENDPOINT,
}

export const KEY_NAMES = ['COPILOT_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_COPILOT_TOKEN']

/** Match the Copilot inference hosts (the quota endpoint lives on api.github.com). */
export function routeFor(baseURL) {
  try {
    const url = new URL(baseURL)
    const hostname = url.hostname
    if (url.protocol !== 'https:') return undefined
    if (hostname.endsWith('githubcopilot.com')) return { endpoint: DEFAULT_ENDPOINT }
    return undefined
  } catch {
    return undefined
  }
}

export async function read(ctx, route) {
  const names = Array.isArray(route.keyNames) && route.keyNames.length > 0 ? route.keyNames : KEY_NAMES
  const token = await resolveKey(ctx, names)
  if (!token) return unavailable(route, 'missing-credential')

  const json = await fetchJson(route.endpoint ?? DEFAULT_ENDPOINT, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GitHubCopilotChat/1.0',
      'Editor-Version': 'vscode/1.0',
      'Editor-Plugin-Version': 'copilot-chat/1.0',
      'Copilot-Integration-Id': 'vscode-chat',
      Authorization: `Bearer ${token}`,
    },
  })

  const premium = snapshotOf(json, 'premium_interactions')
  if (!premium) throw new Error('invalid quota response')
  const remainingPercent = remainingPercentOf(premium)
  if (remainingPercent === undefined) throw new Error('invalid quota response')

  const plan = {
    usedPercent: clampPercent(100 - remainingPercent),
    remainingPercent,
    resetAt: toIso(json?.quota_reset_date),
  }
  if (premium.unlimited === true || premium.overage_permitted === true) plan.unlimited = true

  const result = {
    ok: true,
    provider: route.provider,
    kind,
    planName: typeof json?.copilot_plan === 'string' ? json.copilot_plan : undefined,
    plan,
    updatedAt: nowIso(),
  }

  const chat = snapshotOf(json, 'chat')
  const chatRemaining = chat ? remainingPercentOf(chat) : undefined
  if (chatRemaining !== undefined) {
    result.chat = {
      remainingPercent: chatRemaining,
      usedPercent: clampPercent(100 - chatRemaining),
    }
  }
  return result
}

function snapshotOf(json, name) {
  const snapshot = json?.quota_snapshots?.[name]
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : undefined
}

/** Prefer `percent_remaining`; fall back to entitlement/quota_remaining ratios. */
function remainingPercentOf(snapshot) {
  const direct = numberOf(snapshot.percent_remaining)
  if (direct !== undefined) return clampPercent(Math.round(direct))
  const total = numberOf(snapshot.entitlement)
  const remaining = numberOf(snapshot.quota_remaining) ?? numberOf(snapshot.remaining)
  if (total === undefined || total <= 0 || remaining === undefined) return undefined
  return clampPercent(Math.round((remaining / total) * 100))
}

function numberOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
