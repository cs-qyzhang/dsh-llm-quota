import { message } from './presentation.js'

export function mergeNames(primary, fallback) {
  return [...new Set([...primary, ...fallback].filter((name) => typeof name === 'string' && name.length > 0))]
}

export function cycleView(data, { formatAmount, row }) {
  const hasBalance = data.amount !== undefined
  const amount = formatAmount(data.currency, hasBalance ? data.amount : data.cycleUsage)
  const rows = []
  if (hasBalance) rows.push(row('creditsRemaining', formatAmount(data.currency, data.amount)))
  if (data.cycleUsage !== undefined) rows.push(row('cycleUsage', formatAmount(data.currency, data.cycleUsage)))
  return { compact: message(hasBalance ? 'balance' : 'usedMonth', { amount }), badge: amount, rows }
}

export function planView(data, helpers, options) {
  const { message, formatWindow, resetLabel, row } = helpers
  const plan = data.plan
  if (!plan || !Number.isFinite(plan.remainingPercent)) return { compact: message('error'), badge: '', rows: [] }
  return {
    compact: message(options.compact, { percent: plan.remainingPercent }),
    badge: message('badgePlan', { percent: plan.remainingPercent }),
    rows: [row(options.label, formatWindow(plan), resetLabel(plan.resetAt))],
  }
}
