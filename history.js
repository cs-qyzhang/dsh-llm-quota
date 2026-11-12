import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const HISTORY_INTERVAL_MS = 30_000
export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const HISTORY_MAX_POINTS = 20_000
export const HISTORY_RESPONSE_POINTS = 100

const AMOUNT_FIELDS = ['amount', 'usedAmount', 'cycleUsage']
const WINDOW_FIELDS = ['fiveHour', 'weekly', 'monthly', 'plan', 'chat']

export function historyIntervalMs(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(1, seconds) : HISTORY_INTERVAL_MS / 1000
  return value * 1000
}

export function defaultHistoryPath(env = process.env, home = homedir()) {
  const root = env.DSH_HOME || join(home, '.dsh')
  return join(root, 'data', 'llm-quota-history.sqlite')
}

const DEFAULT_HISTORY = [
  ...AMOUNT_FIELDS.map((key) => ({ key, path: key, unit: 'currency' })),
  ...WINDOW_FIELDS.map((key) => ({ key, path: `${key}.remainingPercent`, unit: 'percent' })),
  ...['month', 'compensation'].map((key) => ({ key: `plan.${key}`, path: `plan.${key}.remainingPercent`, unit: 'percent' })),
]

function atPath(value, path) {
  let current = value
  for (const key of path.split('.')) current = current?.[key]
  return current
}

/** Extract metrics described by the provider's view declaration. */
export function historyPoint(value, spec = DEFAULT_HISTORY) {
  if (!value || value.ok !== true || !Array.isArray(spec)) return undefined
  const metrics = {}
  for (const metric of spec) {
    const number = numericValue(atPath(value, metric.path))
    if (number !== undefined) metrics[metric.key] = number
  }
  if (Object.keys(metrics).length === 0) return undefined

  return {
    at: validTimestamp(value.updatedAt) ?? new Date().toISOString(),
    provider: value.provider,
    kind: value.kind,
    mode: value.mode ?? null,
    currency: value.currency ?? null,
    metrics,
  }
}

/** Bound response size while preserving range endpoints and every metric's extrema. */
export function sampleHistoryPoints(points, maxPoints = HISTORY_RESPONSE_POINTS) {
  const limit = Math.max(2, Number.isFinite(maxPoints) ? Math.floor(maxPoints) : HISTORY_RESPONSE_POINTS)
  if (points.length <= limit) return points

  const selected = new Set([0, points.length - 1])
  const extrema = new Map()
  for (let index = 0; index < points.length; index += 1) {
    for (const [key, raw] of Object.entries(points[index].metrics ?? {})) {
      const value = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(value)) continue
      const current = extrema.get(key)
      if (!current) {
        extrema.set(key, { minimum: value, maximum: value, minimumIndex: index, maximumIndex: index })
        continue
      }
      if (value < current.minimum) {
        current.minimum = value
        current.minimumIndex = index
      }
      if (value > current.maximum) {
        current.maximum = value
        current.maximumIndex = index
      }
    }
  }
  for (const current of extrema.values()) {
    if (selected.size < limit) selected.add(current.minimumIndex)
    if (selected.size < limit) selected.add(current.maximumIndex)
  }

  const slots = limit - selected.size
  for (let index = 1; index <= slots + 1 && selected.size < limit; index += 1) {
    selected.add(Math.floor(index * (points.length - 1) / (slots + 1)))
  }
  for (let index = 1; index < points.length - 1 && selected.size < limit; index += 1) {
    selected.add(index)
  }
  return [...selected].sort((left, right) => left - right).map((index) => points[index])
}

export function createHistoryStore(options) {
  const filePath = options.filePath
  const now = options.now ?? Date.now
  const retentionMs = options.retentionMs ?? HISTORY_RETENTION_MS
  const maxPoints = options.maxPoints ?? HISTORY_MAX_POINTS
  let database
  let statements
  let closed = false

  function open() {
    if (closed) throw new Error('quota history store is closed')
    if (database) return database
    mkdirSync(dirname(filePath), { recursive: true })
    const opened = new DatabaseSync(filePath)
    try {
      opened.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS history_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_key TEXT NOT NULL,
          recorded_at INTEGER NOT NULL,
          provider TEXT NOT NULL,
          kind TEXT,
          mode TEXT,
          currency TEXT,
          signature TEXT NOT NULL,
          metrics TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS history_provider_time
          ON history_points (provider_key, recorded_at, id);
      `)
      database = opened
      statements = {
        last: opened.prepare(`
          SELECT recorded_at, signature FROM history_points
          WHERE provider_key = ? ORDER BY recorded_at DESC, id DESC LIMIT 1
        `),
        insert: opened.prepare(`
          INSERT INTO history_points (
            provider_key, recorded_at, provider, kind, mode, currency, signature, metrics
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `),
        deleteExpired: opened.prepare('DELETE FROM history_points WHERE recorded_at < ?'),
        trim: opened.prepare(`
          DELETE FROM history_points
          WHERE provider_key = ? AND id NOT IN (
            SELECT id FROM history_points WHERE provider_key = ?
            ORDER BY recorded_at DESC, id DESC LIMIT ?
          )
        `),
        baseline: opened.prepare(`
          SELECT * FROM history_points
          WHERE provider_key = ? AND recorded_at <= ?
          ORDER BY recorded_at DESC, id DESC LIMIT 1
        `),
        changes: opened.prepare(`
          SELECT * FROM history_points
          WHERE provider_key = ? AND recorded_at > ?
          ORDER BY recorded_at ASC, id ASC
        `),
      }
      return database
    } catch (error) {
      database = undefined
      statements = undefined
      opened.close()
      throw error
    }
  }

  function transaction(callback) {
    database.exec('BEGIN IMMEDIATE')
    try {
      callback()
      database.exec('COMMIT')
    } catch (error) {
      try { database.exec('ROLLBACK') } catch {}
      throw error
    }
  }

  function insertPoint(key, point) {
    statements.insert.run(
      key,
      Date.parse(point.at),
      point.provider ?? '',
      point.kind ?? null,
      point.mode ?? null,
      point.currency ?? null,
      pointSignature(point),
      JSON.stringify(point.metrics),
    )
  }

  return {
    async record(key, value, spec) {
      const point = historyPoint(value, spec)
      if (!point) return false
      open()
      const cutoff = now() - retentionMs
      const last = statements.last.get(key)
      if (last && last.recorded_at >= cutoff && last.signature === pointSignature(point)) return false

      transaction(() => {
        insertPoint(key, point)
        statements.deleteExpired.run(cutoff)
        statements.trim.run(key, key, maxPoints)
      })
      return true
    },

    async list(key, since) {
      open()
      const sinceMs = typeof since === 'number' ? since : Date.parse(since)
      const baseline = statements.baseline.get(key, sinceMs)
      const changes = statements.changes.all(key, sinceMs)
      return [...(baseline ? [baseline] : []), ...changes].map(rowToPoint)
    },

    async flush() {
      if (database) database.exec('PRAGMA wal_checkpoint(PASSIVE)')
    },

    close() {
      closed = true
      if (database) database.close()
      database = undefined
      statements = undefined
    },
  }
}

export function createHistoryCollector(options) {
  const intervalMs = options.intervalMs ?? HISTORY_INTERVAL_MS
  const concurrency = options.concurrency ?? 3
  let timer = null
  let running = null

  function runOnce() {
    if (running) return running
    const task = (async () => {
      const providers = configuredProviders(options.ctx, options.overrides)
      let cursor = 0
      const worker = async () => {
        while (cursor < providers.length) {
          const provider = providers[cursor]
          cursor += 1
          try {
            const route = await options.resolveRoute(options.ctx, provider, options.overrides)
            if (!route || route.reason) continue
            await options.readRoute(route, { force: true })
          } catch {
            // A single provider must not interrupt the rest of this or later rounds.
          }
        }
      }
      const workers = Array.from(
        { length: Math.min(concurrency, providers.length) },
        () => worker(),
      )
      await Promise.all(workers)
    })()
    running = task
    task.finally(() => {
      if (running === task) running = null
    })
    return task
  }

  return {
    runOnce,
    start() {
      if (timer !== null) return
      timer = setInterval(() => { void runOnce() }, intervalMs)
      timer.unref?.()
      void runOnce()
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
  }
}

function configuredProviders(ctx, overrides) {
  const providers = new Set(Object.keys(overrides ?? {}))
  try {
    for (const entry of ctx.llm.listProviders()) {
      if (entry?.id) providers.add(entry.id)
    }
  } catch {}
  try {
    if (ctx.get('deepseekAccount')) providers.add('deepseek-account')
  } catch {}
  return [...providers]
}

function rowToPoint(row) {
  return {
    at: new Date(row.recorded_at).toISOString(),
    provider: row.provider,
    kind: row.kind,
    mode: row.mode,
    currency: row.currency,
    metrics: JSON.parse(row.metrics),
  }
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const text = value.trim()
  return Number.isFinite(Number(text)) ? text : undefined
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
}

function pointSignature(point) {
  return JSON.stringify([
    point.kind ?? null,
    point.mode ?? null,
    point.currency ?? null,
    point.metrics,
  ])
}
