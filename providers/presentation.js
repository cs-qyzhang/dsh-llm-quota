import { nowIso } from './core.js'

export function message(key, params) {
  return { key, ...(params === undefined ? {} : { params }) }
}

function formatAmount(currency, amount) {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
  const value = typeof amount === 'number' ? amount : Number.parseFloat(amount)
  return Number.isFinite(value) ? `${symbol}${value.toFixed(2)}` : `${symbol}${amount ?? ''}`.trim()
}

function formatNumber(value) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(number) ? number.toLocaleString() : String(value ?? '')
}

function formatWindow(window) {
  if (window.used !== undefined && window.limit !== undefined) {
    return message('mimoUsed', { used: formatNumber(window.used), limit: formatNumber(window.limit), percent: window.usedPercent })
  }
  return message('remaining', { percent: window.remainingPercent })
}

function resetLabel(iso) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return undefined
  const difference = time - Date.now()
  if (difference > 0 && difference < 86_400_000) {
    const hours = Math.floor(difference / 3_600_000)
    const minutes = Math.max(1, Math.floor((difference % 3_600_000) / 60_000))
    return message('resetsIn', { time: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m` })
  }
  return message('resetsAt', { time: { relative: iso, options: { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } } })
}

function row(label, value, note) {
  return { label: typeof label === 'string' ? message(label) : label, value, ...(note ? { note } : {}) }
}

const helpers = { message, formatAmount, formatNumber, formatWindow, resetLabel, row }

export function present(plugin, data) {
  const presented = plugin.present?.(data, helpers) ?? {}
  const view = { ...plugin.view, ...presented }
  delete view.credentials
  delete view.messages
  if (presented.error !== undefined) {
    view.errors = { ...view.errors, [data.reason ?? 'error']: presented.error }
    delete view.error
  }
  if (data.ok === false) {
    Object.assign(view, { title: undefined, compact: undefined, badge: undefined, rows: undefined, gauge: undefined })
  }
  return { viewId: plugin.kind, view }
}

export function providerFailure(plugin, route) {
  return present(plugin, { ...route, ok: false, updatedAt: nowIso() })
}
