window.__ModuleLoader__.load({
  id: '@cs-qyzhang/dsh-llm-quota',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'llm-quota'
    const PACKAGE = '@cs-qyzhang/dsh-llm-quota'
    const REFRESH_MS = 60_000
    const HISTORY_REFRESH_MS = 20_000
    const FETCH_TIMEOUT_MS = 8_000
    const RETRY_MS = 30_000
    const SCAN_DELAY_MS = 250
    const HISTORY_WHEEL_STEP_MS = 220
    const PANEL_WIDTH = 360
    const HISTORY_RANGES = [
      { id: '1h', hours: 1, label: 'historyRange1Hour' },
      { id: '4h', hours: 4, label: 'historyRange4Hours' },
      { id: '12h', hours: 12, label: 'historyRange12Hours' },
      { id: '1d', days: 1, label: 'historyRange1' },
      { id: '7d', days: 7, label: 'historyRange7' },
      { id: '30d', days: 30, label: 'historyRange30' },
    ]
    const DEFAULT_HISTORY_RANGE = '1h'

    function normalizeHistoryRange(value) {
      return HISTORY_RANGES.some((entry) => entry.id === value) ? value : DEFAULT_HISTORY_RANGE
    }

    function formatAmount(currency, amount) {
      const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
      const value = typeof amount === 'number' ? amount : Number.parseFloat(amount)
      if (!Number.isFinite(value)) return `${symbol}${amount ?? ''}`.trim()
      return `${symbol}${value.toFixed(2)}`
    }

    // Provider views arrive from the Host manifest (built from providers/*). The
    // engine owns the manifest-driven layout fallbacks, per-provider copy and row
    // rendering; it lives here because the browser bundle is a single classic
    // script with no module resolution.
    function createViewEngine() {
      let manifest = { views: {}, credentials: [], messages: {} }
      let language = 'en'
      let revision = 0
      const listeners = new Set()

      function publish() {
        revision += 1
        for (const listener of listeners) listener()
      }

      function currentMessage(key) {
        return manifest.messages?.[language]?.[key] ?? manifest.messages?.en?.[key]
      }

      /** Provider params carry relative times as `{ relative, options }`. */
      function formatParam(param) {
        if (param && typeof param === 'object' && typeof param.relative === 'string') {
          return absoluteTime(Date.parse(param.relative), param.options)
        }
        return param
      }

      function paramsOf(params) {
        if (!params || typeof params !== 'object') return params
        return Object.fromEntries(
          Object.entries(params).map(([key, value]) => [key, formatParam(value)]),
        )
      }

      function providerMessage(value) {
        const template = currentMessage(value.key) ?? value.key
        return template.replace(/\{(\w+)\}/g, (_, name) => {
          const param = Object.hasOwn(value.params ?? {}, name) ? value.params[name] : undefined
          return param === undefined ? `{${name}}` : String(formatParam(param))
        })
      }

      function text(value, tr) {
        if (Array.isArray(value)) return value.map((entry) => text(entry, tr)).join('')
        if (value && typeof value === 'object' && typeof value.key === 'string') {
          return currentMessage(value.key) !== undefined
            ? providerMessage(value)
            : tr(value.key, paramsOf(value.params))
        }
        return String(value ?? '')
      }

      function formatNumber(value) {
        const number = typeof value === 'number' ? value : Number.parseFloat(value)
        return Number.isFinite(number) ? number.toLocaleString() : String(value ?? '')
      }

      function formatWindow(window, tr) {
        if (window.used !== undefined && window.limit !== undefined) {
          return tr('mimoUsed', {
            used: formatNumber(window.used),
            limit: formatNumber(window.limit),
            percent: window.usedPercent,
          })
        }
        return tr('remaining', { percent: window.remainingPercent })
      }

      function relativeDuration(milliseconds) {
        const hours = Math.floor(milliseconds / 3_600_000)
        const minutes = Math.max(1, Math.floor((milliseconds % 3_600_000) / 60_000))
        return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
      }

      function absoluteTime(time, options) {
        return new Date(time).toLocaleString(undefined, options ?? {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      }

      function resetLabel(iso, tr) {
        const time = Date.parse(iso)
        if (!Number.isFinite(time)) return null
        const difference = time - Date.now()
        if (difference > 0 && difference < 86_400_000) {
          return tr('resetsIn', { time: relativeDuration(difference) })
        }
        return tr('resetsAt', { time: absoluteTime(time) })
      }

      function rowSpec(label, value, note) {
        return note ? { label, value, note } : { label, value }
      }

      const groups = {
        balance: {
          gauge: () => false,
          compact: (data, tr) => tr('balance', { amount: formatAmount(data.currency, data.amount) }),
          badge: (data) => formatAmount(data.currency, data.amount),
          rows(data, tr) {
            const specs = []
            for (const wallet of Array.isArray(data.wallets) ? data.wallets : []) {
              specs.push(rowSpec(tr('toppedUp'), formatAmount(wallet.currency, wallet.balance)))
            }
            for (const wallet of Array.isArray(data.bonusWallets) ? data.bonusWallets : []) {
              if (Number.parseFloat(wallet.balance) > 0) specs.push(rowSpec(tr('bonus'), formatAmount(wallet.currency, wallet.balance)))
            }
            if (data.cycleUsage !== undefined) specs.push(rowSpec(tr('cycleUsage'), formatAmount(data.currency, data.cycleUsage)))
            if (typeof data.available === 'boolean') specs.push(rowSpec(tr('status'), data.available ? tr('available') : tr('insufficient')))
            return specs
          },
        },
        credits: {
          gauge: () => false,
          compact: (data, tr) => tr('balance', { amount: formatAmount(data.currency, data.amount) }),
          badge: (data) => formatAmount(data.currency, data.amount),
          rows(data, tr) {
            const specs = []
            if (data.amount !== undefined) specs.push(rowSpec(tr('creditsRemaining'), formatAmount(data.currency, data.amount)))
            if (data.totalCredits !== undefined) specs.push(rowSpec(tr('creditsPurchased'), formatAmount(data.currency, data.totalCredits)))
            if (data.totalUsage !== undefined) specs.push(rowSpec(tr('creditsUsed'), formatAmount(data.currency, data.totalUsage)))
            return specs
          },
        },
        usage: {
          gauge: () => false,
          compact(data, tr) {
            if (data.usedAmount !== undefined) return tr('usedMonth', { amount: formatAmount(data.currency, data.usedAmount) })
            if (Number.isFinite(data.requestCount)) return tr('usedRequests', { count: data.requestCount })
            return tr('error')
          },
          badge(data) {
            if (data.usedAmount !== undefined) return formatAmount(data.currency, data.usedAmount)
            return Number.isFinite(data.requestCount) ? String(data.requestCount) : ''
          },
          rows(data, tr) {
            const specs = []
            if (data.usedAmount !== undefined) specs.push(rowSpec(tr('usedMonthName'), formatAmount(data.currency, data.usedAmount)))
            if (Number.isFinite(data.requestCount)) specs.push(rowSpec(tr('requestCountName'), String(data.requestCount)))
            if (Number.isFinite(data.inputTokens) && Number.isFinite(data.outputTokens)) specs.push(rowSpec(tr('tokenUsage'), `${data.inputTokens} / ${data.outputTokens}`))
            if (Number.parseFloat(data.creditsAmount) > 0 && data.chargedAmount !== undefined) {
              specs.push(rowSpec(tr('creditsApplied'), formatAmount(data.currency, data.creditsAmount)))
              specs.push(rowSpec(tr('chargedAmount'), formatAmount(data.currency, data.chargedAmount)))
            }
            return specs
          },
        },
        plan: {
          gauge: () => true,
          compact(data, tr) {
            const parts = []
            if (data.fiveHour) parts.push(tr('fiveHour', { percent: data.fiveHour.remainingPercent }))
            if (data.weekly) parts.push(tr('weekly', { percent: data.weekly.remainingPercent }))
            return parts.length > 0 ? parts.join(' · ') : tr('error')
          },
          badge(data, tr) {
            const parts = []
            if (data.fiveHour && Number.isFinite(data.fiveHour.remainingPercent)) parts.push(tr('badgeFiveHour', { percent: data.fiveHour.remainingPercent }))
            if (data.weekly && Number.isFinite(data.weekly.remainingPercent)) parts.push(tr('badgeWeekly', { percent: data.weekly.remainingPercent }))
            return parts.join(' · ')
          },
          rows(data, tr) {
            const specs = []
            for (const [key, label] of [['fiveHour', 'fiveHourName'], ['weekly', 'weeklyName'], ['monthly', 'monthlyName']]) {
              if (data[key]) specs.push(rowSpec(tr(label), tr('remaining', { percent: data[key].remainingPercent }), resetLabel(data[key].resetAt, tr)))
            }
            return specs
          },
        },
      }

      function viewOf(data) {
        const id = data?.viewId ?? data?.kind
        const registered = manifest.views[id]
        const supplied = data?.view
        if (supplied && Object.keys(supplied).length > 0) return { ...registered, ...supplied }
        return registered ?? {
          preset: data?.kind === 'balance' || data?.amount !== undefined || data?.wallets !== undefined || typeof data?.available === 'boolean' ? 'balance'
            : data?.usedAmount !== undefined || data?.requestCount !== undefined ? 'usage' : 'plan',
          title: { key: 'balanceTitle' }, gauge: false,
        }
      }

      function groupOf(view) {
        return groups[view.preset ?? view.group] ?? groups.plan
      }

      function renderRows(data, tr) {
        const rows = data?.view?.rows ?? manifest.views[data?.viewId ?? data?.kind]?.rows
        return rows?.map((row) => ({
          ...row,
          label: text(row.label, tr),
          value: text(row.value, tr),
          ...(row.note ? { note: text(row.note, tr) } : {}),
        }))
      }

      function compactLabel(data, tr) {
        if (!data || data.ok === false) return tr('error')
        const view = viewOf(data)
        return view.compact !== undefined ? text(view.compact, tr) : groupOf(view).compact(data, tr)
      }

      function badgeText(data, tr) {
        if (!data || data.ok !== true) return ''
        const view = viewOf(data)
        return view.badge !== undefined ? text(view.badge, tr) : groupOf(view).badge(data, tr)
      }

      function panelTitle(data, tr) {
        if (!data || data.ok === false) return tr('title')
        return text(viewOf(data).title, tr)
      }

      function errorLabel(data, tr) {
        if (!data) return tr('error')
        const view = viewOf(data)
        const custom = view.errors?.[data.reason]
        if (custom !== undefined) return text(custom, tr)
        if (data.reason === 'missing-credential') return tr('missingCredential')
        return tr('error')
      }

      function rowSpecsOf(data, tr) {
        const view = viewOf(data)
        return renderRows(data, tr) ?? groupOf(view).rows(data, tr)
      }

      function providerGauge(data) {
        if (!data) return false
        const view = viewOf(data)
        return view.gauge ?? groupOf(view).gauge(data)
      }

      function historyMetric(key) {
        return manifest.history?.[key] ?? {}
      }

      function historySeries(points) {
        const groups = new Map()
        for (const point of points) {
          const time = Date.parse(point?.at)
          if (!Number.isFinite(time) || !point.metrics || typeof point.metrics !== 'object') continue
          for (const [key, raw] of Object.entries(point.metrics)) {
            const value = typeof raw === 'number' ? raw : Number(raw)
            if (!Number.isFinite(value)) continue
            const unit = historyMetric(key).unit === 'currency' ? (point.currency ?? '') : (historyMetric(key).unit ?? 'percent')
            const id = `${key}:${unit}`
            if (!groups.has(id)) groups.set(id, { id, key, unit, points: [] })
            groups.get(id).points.push({ at: point.at, time, raw, value })
          }
        }
        return [...groups.values()]
      }

      function preferredHistorySeries(series) {
        for (const key of manifest.historyPriority ?? []) {
          const match = series.find((entry) => entry.key === key)
          if (match) return match
        }
        return series[0]
      }

      function historyMetricLabel(key, tr) {
        return text(historyMetric(key).label ?? key, tr)
      }

      return {
        setManifest(value) {
          manifest = value ?? { views: {}, credentials: [], messages: {} }
          publish()
        },
        setLanguage(value) {
          const id = String(value || 'en').toLowerCase()
          const next = Object.hasOwn(manifest.messages ?? {}, id) ? id : id.split('-')[0]
          if (next === language) return
          language = next
          publish()
        },
        getSnapshot: () => revision,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        credentialRows: () => manifest.credentials ?? [],
        text,
        viewOf, compactLabel, badgeText, panelTitle, errorLabel, rowSpecsOf, providerGauge,
        formatNumber, formatWindow, absoluteTime, resetLabel,
        historySeries, preferredHistorySeries, historyMetricLabel,
      }
    }

    const views = createViewEngine()
    const { compactLabel, badgeText, panelTitle, errorLabel, rowSpecsOf, providerGauge,
      formatNumber, formatWindow, absoluteTime, resetLabel, historySeries,
      preferredHistorySeries, historyMetricLabel } = views

    const TOKENS = {
      text: 'var(--dsw-alias-label-tertiary)',
      textStrong: 'var(--dsw-alias-label-primary)',
      textDim: 'var(--dsw-alias-label-caption)',
      textSecondary: 'var(--dsw-alias-label-secondary)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      panel: 'var(--dsw-specific-menu)',
      border: 'var(--dsw-alias-border-l1)',
      shadow: 'var(--dsw-elevation-panel)',
      radius: 'var(--dsw-radius-lg)',
      radiusSm: 'var(--dsw-radius-sm)',
      backdrop: 'var(--dsw-menu-backdrop-filter, none)',
      input: 'var(--dsw-alias-settings-card-fill)',
      inputBorder: 'var(--dsw-alias-border-l2)',
      primary: 'var(--dsw-alias-button-primary-fill)',
      primaryText: 'var(--dsw-alias-label-primary-foreground)',
      link: 'var(--dsw-alias-link)',
      danger: 'var(--dsw-alias-state-error-primary)',
      skeleton: 'var(--dsw-alias-bg-skeleton)',
    }

    function GaugeIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      }, h('path', {
        d: 'M8 2a6 6 0 0 0-6 6h2a4 4 0 0 1 8 0h2a6 6 0 0 0-6-6Zm-.9 4.3 2.6 2.6-1.1 1.1-2.6-2.6 1.1-1.1Z',
        fill: 'currentColor',
      }))
    }

    function CoinIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        style: { flex: 'none', display: 'block' },
      },
      h('circle', { cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
      h('path', { d: 'M8 4.6v6.8M6.2 6.4h2.3a1.3 1.3 0 0 1 0 2.6H6.2M6.2 8.4h2.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }))
    }

    // Message cache backing the fallback translator. The primary `t` is the one
    // the locale service binds after the Host dictionaries register.
    let messages = {}

    function fallbackTranslate(key, params) {
      const template = messages.en?.[key] ?? key
      return template.replace(/\{(\w+)\}/g, (_, name) => (
        params && Object.hasOwn(params, name) && params[name] !== undefined ? String(params[name]) : `{${name}}`
      ))
    }

    /** Read a Remote failure or thrown error as one short line. */
    function remoteErrorText(error) {
      if (error instanceof Error) return error.message.slice(0, 300)
      if (error && typeof error === 'object') {
        if (typeof error.message === 'string') return error.message.slice(0, 300)
        if (typeof error.code === 'string') return error.code
        try {
          return JSON.stringify(error).slice(0, 300)
        } catch {}
      }
      return String(error ?? 'unknown error').slice(0, 300)
    }

    /** Resolve a Remote call as a result, or throw its error. */
    async function remoteResult(call) {
      const response = await call()
      if (!response || response.ok !== true) {
        const failure = new Error(remoteErrorText(response?.error))
        if (typeof response?.error?.code === 'string') failure.code = response.error.code
        throw failure
      }
      return response.value
    }


    async function requestQuota(provider, signal) {
      const query = provider ? `?provider=${encodeURIComponent(provider)}` : ''
      const response = await fetch(`/api/llm-quota${query}`, {
        signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('invalid quota response')
      }
      return data
    }

    // Dictionaries live in the bundle's `locale/*.json` (single source of truth
    // for every user-facing string, shared with the plugin manager page) and
    // arrive through the Host i18n route.
    async function requestDictionaries(signal) {
      const response = await fetch('/api/llm-quota/i18n', {
        signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!data || data.ok !== true || !data.dictionaries || typeof data.dictionaries !== 'object' || Array.isArray(data.dictionaries)) {
        throw new Error('invalid i18n response')
      }
      return data.dictionaries
    }

    async function requestViews(signal) {
      const response = await fetch('/api/llm-quota/views', { signal, headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!data || data.ok !== true || !data.views || typeof data.views !== 'object') throw new Error('invalid views response')
      return data
    }

    async function requestQuotaHistory(provider, range, signal) {
      const selected = HISTORY_RANGES.find((entry) => entry.id === normalizeHistoryRange(range))
      const query = new URLSearchParams()
      if (range !== null && range !== undefined) {
        if (selected.hours) query.set('hours', String(selected.hours))
        else query.set('days', String(selected.days))
      }
      if (provider) query.set('provider', provider)
      const response = await fetch(`/api/llm-quota/history?${query}`, {
        signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!data || data.ok !== true || !Array.isArray(data.points)) {
        throw new Error('invalid quota history response')
      }
      return data
    }

    function detailRow(label, value, note) {
      return h('div', {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '2px 0',
        },
      },
      h('span', { style: { color: TOKENS.text, flex: 'none' } }, label),
      h('span', { style: { minWidth: 0, textAlign: 'right' } },
        h('span', { style: { color: TOKENS.textStrong, fontVariantNumeric: 'tabular-nums' } }, value),
        note ? h('span', { style: { display: 'block', color: TOKENS.textDim, fontSize: 11, lineHeight: '16px' } }, note) : null))
    }

    function historyValue(unit, value, precise = false) {
      if (unit === 'percent') return `${formatNumber(value)}%`
      if (precise) {
        const symbol = unit === 'CNY' ? '¥' : unit === 'USD' ? '$' : ''
        const suffix = symbol || !unit ? '' : ` ${unit}`
        return `${symbol}${String(value)}${suffix}`
      }
      return formatAmount(unit, value)
    }

    function historyDelta(unit, value) {
      const sign = value > 0 ? '+' : value < 0 ? '-' : ''
      return `${sign}${historyValue(unit, Math.abs(value))}`
    }

    function preciseTime(time) {
      return new Date(time).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    }

    function HistoryChart({ series, since, tr, onRangeStep }) {
      const svgRef = React.useRef(null)
      React.useEffect(() => {
        const svg = svgRef.current
        if (!svg) return undefined
        const onWheel = (event) => {
          if (event.deltaY === 0) return
          event.preventDefault()
          event.stopPropagation()
          onRangeStep(event.deltaY < 0 ? -1 : 1)
        }
        svg.addEventListener('wheel', onWheel, { passive: false })
        return () => svg.removeEventListener('wheel', onWheel)
      }, [onRangeStep])

      const parsedStart = Date.parse(since)
      const firstPoint = series.points[0]
      const start = Number.isFinite(parsedStart) ? parsedStart : firstPoint.time
      // Point times come from the Host clock; when the browser clock lags behind
      // it, the window must still cover the newest sample or points get dropped.
      const end = Math.max(Date.now(), start + 1, series.points[series.points.length - 1].time)
      let baseline
      const changes = []
      for (const point of series.points) {
        if (point.time <= start) baseline = point
        else if (point.time <= end) changes.push(point)
      }
      const actual = baseline ? [baseline, ...changes] : changes
      if (actual.length === 0) return null
      const drawn = baseline ? [{ ...baseline, time: start }, ...changes] : [...changes]
      const lastDrawn = drawn[drawn.length - 1]
      if (lastDrawn.time < end) drawn.push({ ...lastDrawn, time: end, synthetic: true })

      const width = 320
      const height = 140
      const left = 46
      const right = 8
      const top = 10
      const bottom = 25
      const plotWidth = width - left - right
      const plotHeight = height - top - bottom
      const values = drawn.map((point) => point.value)
      let minimum = Math.min(...values)
      let maximum = Math.max(...values)
      if (series.unit === 'percent') {
        minimum = 0
        maximum = 100
      } else {
        const spread = maximum - minimum
        const padding = spread > 0 ? spread * 0.15 : Math.max(Math.abs(maximum) * 0.05, 1)
        minimum -= padding
        maximum += padding
      }
      const x = (time) => left + Math.max(0, Math.min(1, (time - start) / (end - start))) * plotWidth
      const y = (value) => top + (maximum - value) / (maximum - minimum) * plotHeight
      let path = `M ${x(drawn[0].time)} ${y(drawn[0].value)}`
      for (let index = 1; index < drawn.length; index += 1) {
        path += ` H ${x(drawn[index].time)} V ${y(drawn[index].value)}`
      }

      const first = actual[0]
      const last = actual[actual.length - 1]
      const label = historyMetricLabel(series.key, tr)
      const stat = (name, value) => h('span', { style: { minWidth: 0 } },
        h('span', { style: { display: 'block', color: TOKENS.textDim, fontSize: 10 } }, name),
        h('span', { style: { color: TOKENS.textStrong, fontVariantNumeric: 'tabular-nums' } }, value))
      const circleStep = Math.max(1, Math.ceil(changes.length / 100))
      const circles = changes.filter((_point, index) => index % circleStep === 0)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 } },
          stat(tr('historyFirst'), historyValue(series.unit, first.raw)),
          stat(tr('historyLatest'), historyValue(series.unit, last.raw)),
          stat(tr('historyChange'), historyDelta(series.unit, last.value - first.value))),
        h('svg', {
          ref: svgRef,
          viewBox: `0 0 ${width} ${height}`,
          width: '100%',
          role: 'img',
          title: tr('historyWheelHint'),
          'aria-label': tr('historyChartLabel', { metric: label }),
          style: { display: 'block', overflow: 'visible' },
        },
        [0, 0.5, 1].map((ratio) => {
          const lineY = top + ratio * plotHeight
          const value = maximum - ratio * (maximum - minimum)
          return h('g', { key: ratio },
            h('line', {
              x1: left, x2: width - right, y1: lineY, y2: lineY,
              stroke: TOKENS.border, strokeWidth: 0.6,
            }),
            h('text', {
              x: left - 6, y: lineY + 3, textAnchor: 'end',
              fill: TOKENS.textDim, fontSize: 9,
            }, historyValue(series.unit, value)))
        }),
        h('path', {
          d: path, fill: 'none', stroke: TOKENS.link, strokeWidth: 1.8,
          strokeLinejoin: 'round', strokeLinecap: 'round',
        }),
        circles.map((point, index) => h('circle', {
          key: `${point.at}-${index}`,
          cx: x(point.time), cy: y(point.value), r: 2.5,
          fill: TOKENS.link, stroke: TOKENS.panel, strokeWidth: 1,
        }, h('title', null, `${preciseTime(point.at)}\n${label}: ${historyValue(series.unit, point.raw, true)}`))),
        h('text', { x: left, y: height - 4, fill: TOKENS.textDim, fontSize: 9 }, absoluteTime(start)),
        h('text', {
          x: width - right, y: height - 4, textAnchor: 'end',
          fill: TOKENS.textDim, fontSize: 9,
        }, absoluteTime(end))))
    }

    function QuotaHistory({ provider, tr }) {
      const [range, setRange] = React.useState(DEFAULT_HISTORY_RANGE)
      const [selected, setSelected] = React.useState('')
      const [state, setState] = React.useState({ loading: true, error: false, points: [], since: '' })
      const lastWheelAt = React.useRef(0)
      const userSelectedRef = React.useRef(false)
      const initialRequestedRef = React.useRef(false)
      const selectRange = (value) => {
        userSelectedRef.current = true
        setRange(normalizeHistoryRange(value))
      }
      const onRangeStep = React.useCallback((direction) => {
        const now = Date.now()
        if (now - lastWheelAt.current < HISTORY_WHEEL_STEP_MS) return
        lastWheelAt.current = now
        userSelectedRef.current = true
        setRange((current) => {
          const index = HISTORY_RANGES.findIndex((entry) => entry.id === current)
          const next = Math.max(0, Math.min(HISTORY_RANGES.length - 1, index + direction))
          return HISTORY_RANGES[next].id
        })
      }, [])

      React.useEffect(() => {
        let disposed = false
        let active = null
        const initial = !initialRequestedRef.current
        initialRequestedRef.current = true
        const load = async () => {
          if (active) return
          const controller = new AbortController()
          const abortTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
          const current = { controller, abortTimer }
          active = current
          try {
            const data = await requestQuotaHistory(provider, initial ? null : range, controller.signal)
            if (disposed) return
            const configuredRange = normalizeHistoryRange(data.historyDefaultRange)
            if (configuredRange !== range && !userSelectedRef.current) {
              setRange(configuredRange)
            } else {
              setState({ loading: false, error: false, points: data.points, since: data.since })
            }
          } catch {
            if (!disposed) setState((previous) => ({ ...previous, loading: false, error: true }))
          } finally {
            clearTimeout(abortTimer)
            if (active === current) active = null
          }
        }
        setState({ loading: true, error: false, points: [], since: '' })
        void load()
        const timer = setInterval(() => { void load() }, HISTORY_REFRESH_MS)
        return () => {
          disposed = true
          clearInterval(timer)
          if (active) {
            clearTimeout(active.abortTimer)
            active.controller.abort()
            active = null
          }
        }
      }, [provider, range])

      const series = historySeries(state.points)
      const current = series.find((entry) => entry.id === selected) ?? preferredHistorySeries(series)
      const selectStyle = {
        maxWidth: 158,
        height: 26,
        padding: '0 4px',
        border: `0.5px solid ${TOKENS.inputBorder}`,
        borderRadius: TOKENS.radiusSm,
        background: TOKENS.input,
        color: TOKENS.textStrong,
        font: 'inherit',
        fontSize: 11,
      }
      let content
      if (state.loading && state.points.length === 0) {
        content = h('div', { style: { color: TOKENS.textDim } }, tr('historyLoading'))
      } else if (state.error && state.points.length === 0) {
        content = h('div', { style: { color: TOKENS.textDim } }, tr('historyError'))
      } else if (state.points.length === 0) {
        content = h('div', { style: { color: TOKENS.textDim } }, tr('historyEmpty'))
      } else if (!current) {
        content = h('div', { style: { color: TOKENS.textDim } }, tr('historyNoMetrics'))
      } else {
        content = h(HistoryChart, { series: current, since: state.since, tr, onRangeStep })
      }

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 8,
          paddingTop: 8, borderTop: `0.5px solid ${TOKENS.border}`,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { color: TOKENS.textStrong, fontWeight: 500 } }, tr('historyTitle')),
        h('select', {
          value: range,
          onChange: (event) => selectRange(event.target.value),
          'aria-label': tr('historyTitle'),
          style: selectStyle,
        }, HISTORY_RANGES.map((entry) => h('option', { key: entry.id, value: entry.id }, tr(entry.label))))),
      series.length > 1 ? h('label', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { color: TOKENS.textDim } }, tr('historyMetric')),
        h('select', {
          value: current?.id ?? '',
          onChange: (event) => setSelected(event.target.value),
          'aria-label': tr('historyMetric'),
          style: selectStyle,
        }, series.map((entry) => h('option', { key: entry.id, value: entry.id }, historyMetricLabel(entry.key, tr))))) : null,
      state.error && state.points.length > 0
        ? h('div', { style: { color: TOKENS.textDim, fontSize: 11 } }, tr('historyError'))
        : null,
      content)
    }

    // Model-selection labels are decorated through the DOM hooks ui-model-selection
    // publishes (data-provider-id on label wrappers, data-menu-group(-heading) in
    // menus) so the shipped 1017 badge keeps its single-slot registration.
    const BADGE_BASE_CSS = `
button[aria-haspopup="menu"] > span > span[data-provider-id]::before,
section[data-menu-group]:has(span[data-provider-id]) > [data-menu-group-heading]::after {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
button[aria-haspopup="menu"] > span > span[data-provider-id]::before {
  margin-right: 4px;
}
section[data-menu-group]:has(span[data-provider-id]) > [data-menu-group-heading]::after {
  position: absolute;
  right: 7px;
  top: 50%;
  transform: translateY(-50%);
}
`

    function installModelBadges(locale, tr, testHooks) {
      if (typeof document === 'undefined' || !document.head || typeof MutationObserver === 'undefined') {
        return () => {}
      }

      const style = document.createElement('style')
      style.id = 'llm-quota-model-badges'
      style.dataset.plugin = '@cs-qyzhang/dsh-llm-quota'
      document.head.appendChild(style)

      const feed = new Map()
      let disposed = false
      let scanTimer = null
      let refreshTimer = null
      let stopLocale = null
      let stopViews = null

      const render = () => {
        const rules = []
        for (const [provider, entry] of feed) {
          const text = badgeText(entry.data, tr)
          if (!text) continue
          const id = JSON.stringify(provider)
          const value = JSON.stringify(text)
          rules.push(`section[data-menu-group]:has(span[data-provider-id=${id}]) > [data-menu-group-heading]::after{content:${value}}`)
          rules.push(`button[aria-haspopup="menu"] > span > span[data-provider-id=${id}]::before{content:${value}}`)
        }
        style.textContent = BADGE_BASE_CSS + rules.join('\n')
      }

      const load = (provider) => {
        let entry = feed.get(provider)
        if (!entry) {
          entry = { data: null, at: 0, failedAt: 0, pending: null }
          feed.set(provider, entry)
        }
        if (entry.pending) return
        const now = Date.now()
        if (entry.data && now - entry.at < REFRESH_MS) return
        if (entry.failedAt !== 0 && now - entry.failedAt < RETRY_MS) return
        const controller = new AbortController()
        const abortTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        const current = { controller, abortTimer }
        entry.pending = current
        requestQuota(provider, controller.signal)
          .then((data) => {
            if (data.ok === false && data.reason === 'error') {
              entry.failedAt = Date.now()
              return
            }
            entry.data = data
            entry.at = Date.now()
            entry.failedAt = 0
          })
          .catch(() => {
            entry.failedAt = Date.now()
          })
          .finally(() => {
            clearTimeout(abortTimer)
            if (entry.pending === current) entry.pending = null
            if (!disposed) render()
          })
      }

      const scan = () => {
        const seen = new Set()
        for (const node of document.querySelectorAll('span[data-provider-id]')) {
          const provider = node.getAttribute('data-provider-id')
          if (!provider || seen.has(provider)) continue
          seen.add(provider)
          load(provider)
        }
        // Drop providers that disappeared from the DOM so their quota polling
        // stops; the periodic refresh runs after scan and re-renders from `feed`.
        for (const provider of [...feed.keys()]) {
          if (!seen.has(provider)) feed.delete(provider)
        }
      }

      const schedule = () => {
        if (scanTimer !== null) return
        scanTimer = setTimeout(() => {
          scanTimer = null
          scan()
          render()
        }, SCAN_DELAY_MS)
      }

      const relevant = (node) => node.nodeType === 1 && (
        node.matches('[data-menu-group], span[data-provider-id]')
        || node.querySelector('[data-menu-group], span[data-provider-id]') !== null
      )

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (relevant(node)) {
              schedule()
              return
            }
          }
        }
      })
      observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true })

      try {
        if (typeof locale?.subscribe === 'function') stopLocale = locale.subscribe(render)
        stopViews = views.subscribe(render)
      } catch {}

      scan()
      render()
      testHooks?.({ feed, scan })
      refreshTimer = setInterval(() => {
        scan()
        render()
      }, REFRESH_MS)

      return () => {
        disposed = true
        observer.disconnect()
        if (refreshTimer !== null) clearInterval(refreshTimer)
        if (scanTimer !== null) clearTimeout(scanTimer)
        try {
          stopLocale?.()
          stopViews?.()
        } catch {}
        for (const entry of feed.values()) {
          if (!entry.pending) continue
          clearTimeout(entry.pending.abortTimer)
          entry.pending.controller.abort()
          entry.pending = null
        }
        style.remove()
      }
    }

    function rowButton(disabled, primary) {
      return {
        flex: 'none',
        height: 30,
        padding: '0 12px',
        borderRadius: TOKENS.radiusSm,
        border: primary ? 'none' : `1px solid ${TOKENS.inputBorder}`,
        background: primary ? (disabled ? TOKENS.skeleton : TOKENS.primary) : 'transparent',
        color: primary ? TOKENS.primaryText : TOKENS.textSecondary,
        font: 'inherit',
        fontSize: 12,
        whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }
    }

    /**
     * One extra console credential for a provider family. The value is staged in
     * the browser and written through the Host credentials Remote, so it never
     * rides a read path back to the page.
     */
    function CredentialRow(props) {
      const tr = props.t
      const refs = props.refs
      const describeRef = React.useRef(props.describeCredentials)
      const writeRef = React.useRef(props.writeCredential)
      const removeRef = React.useRef(props.removeCredential)
      describeRef.current = props.describeCredentials
      writeRef.current = props.writeCredential
      removeRef.current = props.removeCredential

      const alive = React.useRef(true)
      const [views, setViews] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [loadError, setLoadError] = React.useState('')
      const [draft, setDraft] = React.useState('')
      const [visible, setVisible] = React.useState(false)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState(null)

      const load = React.useCallback(async () => {
        setLoading(true)
        setLoadError('')
        try {
          const value = await remoteResult(() => describeRef.current(refs))
          if (!alive.current) return
          setViews(value && typeof value === 'object' ? value : {})
        } catch (failure) {
          if (!alive.current) return
          setViews(null)
          setLoadError(remoteErrorText(failure))
        } finally {
          if (alive.current) setLoading(false)
        }
      }, [refs])

      React.useEffect(() => {
        alive.current = true
        load()
        return () => {
          alive.current = false
        }
      }, [load])

      const configuredRefs = refs.filter((ref) => views?.[ref]?.configured === true)
      const configured = configuredRefs.length > 0
      const primaryWritable = views?.[refs[0]]?.writable !== false
      const clearable = configuredRefs.some((ref) => views?.[ref]?.writable !== false)
      const source = configuredRefs
        .map((ref) => views?.[ref]?.source)
        .find((value) => typeof value === 'string' && value.length > 0)
      const disabled = busy !== '' || loading || loadError !== '' || !primaryWritable
      // clear() skips read-only refs on its own, so clearing stays available as
      // long as any configured ref is writable even when the primary is not.
      const clearDisabled = busy !== '' || loading || loadError !== '' || !clearable

      const status = loading
        ? tr('credentialLoading')
        : configured
          ? (configuredRefs[0] === refs[0]
              ? tr('credentialConfigured')
              : tr('credentialVia', { ref: configuredRefs[0] }))
          : tr('credentialNotConfigured')

      const save = async () => {
        if (disabled) return
        if (draft.trim() === '') {
          setError({ key: 'credentialEmpty' })
          setNotice('')
          return
        }
        setBusy('save')
        setError(null)
        setNotice('')
        try {
          await remoteResult(() => writeRef.current(refs[0], draft))
          if (!alive.current) return
          setDraft('')
          setNotice('credentialSaved')
          await load()
        } catch (failure) {
          if (!alive.current) return
          setError({ key: 'credentialSaveFailed', message: remoteErrorText(failure) })
        } finally {
          if (alive.current) setBusy('')
        }
      }

      const clear = async () => {
        if (clearDisabled) return
        setBusy('clear')
        setError(null)
        setNotice('')
        try {
          for (const ref of configuredRefs) {
            if (views?.[ref]?.writable === false) continue
            await remoteResult(() => removeRef.current(ref))
          }
          if (!alive.current) return
          await load()
        } catch (failure) {
          if (!alive.current) return
          setError({ key: 'credentialClearFailed', message: remoteErrorText(failure) })
        } finally {
          if (alive.current) setBusy('')
        }
      }

      return h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '12px 0',
          borderTop: `0.5px solid ${TOKENS.border}`,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 } },
        h('span', { style: { color: TOKENS.textStrong, fontSize: 13, fontWeight: 500 } }, props.label),
        h('span', {
          style: {
            padding: '1px 6px',
            borderRadius: 999,
            background: 'var(--dsw-alias-bg-module-platform)',
            color: configured ? TOKENS.textSecondary : TOKENS.textDim,
            fontSize: 11,
            lineHeight: '16px',
            fontVariantNumeric: 'tabular-nums',
          },
        }, status),
        source ? h('span', { style: { color: TOKENS.textDim, fontSize: 11 } }, tr('credentialSource', { source })) : null),
      h('p', { style: { margin: 0, color: TOKENS.textDim, fontSize: 11, lineHeight: '16px' } }, props.hint),
      h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 } },
        h('input', {
          type: visible ? 'text' : 'password',
          value: draft,
          placeholder: props.placeholder,
          disabled,
          autoComplete: 'off',
          spellCheck: false,
          'aria-label': props.label,
          onChange: (event) => {
            setDraft(event.target.value)
            setError(null)
            setNotice('')
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') save()
          },
          style: {
            flex: '1 1 220px',
            minWidth: 0,
            height: 30,
            boxSizing: 'border-box',
            padding: '0 10px',
            borderRadius: TOKENS.radiusSm,
            border: `1px solid ${TOKENS.inputBorder}`,
            background: TOKENS.input,
            color: TOKENS.textStrong,
            font: 'inherit',
            fontSize: 12,
            outline: 'none',
          },
        }),
        h('button', { type: 'button', disabled, onClick: () => setVisible((value) => !value), style: rowButton(disabled, false) },
          visible ? tr('credentialHide') : tr('credentialShow')),
        h('button', { type: 'button', disabled, onClick: save, style: rowButton(disabled, true) },
          busy === 'save' ? tr('credentialSaving') : tr('credentialSave')),
        configured ? h('button', {
          type: 'button',
          disabled: clearDisabled,
          onClick: clear,
          style: rowButton(clearDisabled, false),
        }, busy === 'clear' ? tr('credentialClearing') : tr('credentialClear')) : null),
      configured && !primaryWritable ? h('p', {
        style: { margin: 0, color: TOKENS.textDim, fontSize: 11, lineHeight: '16px' },
      }, tr('credentialReadOnly')) : null,
      loadError ? h('p', {
        role: 'alert',
        style: { margin: 0, color: TOKENS.danger, fontSize: 11, lineHeight: '16px' },
      }, tr('credentialLoadFailed', { message: loadError })) : null,
      error ? h('p', {
        role: 'alert',
        style: { margin: 0, color: TOKENS.danger, fontSize: 11, lineHeight: '16px' },
      }, tr(error.key, { message: error.message })) : null,
      notice ? h('p', {
        role: 'status',
        style: { margin: 0, color: TOKENS.textSecondary, fontSize: 11, lineHeight: '16px' },
      }, tr(notice)) : null)
    }

    function createSettingsDraft(value = {}) {
      return {
        cacheSeconds: String(value.cacheSeconds ?? 30),
        history: value.history !== false,
        historyDefaultRange: normalizeHistoryRange(value.historyDefaultRange),
        historyIntervalSeconds: String(value.historyIntervalSeconds ?? 30),
        providerModules: JSON.stringify(value.providerModules ?? [], null, 2),
        providers: JSON.stringify(value.providers ?? {}, null, 2),
      }
    }

    function settingsOperations(draft, snapshot) {
      const current = snapshot.value ?? {}
      const user = snapshot.user && typeof snapshot.user === 'object' ? snapshot.user : {}
      const cacheText = draft.cacheSeconds.trim()
      const intervalText = draft.historyIntervalSeconds.trim()
      const providersText = draft.providers.trim()
      const modulesText = draft.providerModules.trim()
      let cacheSeconds
      let historyIntervalSeconds
      let providers
      let providerModules

      const historyDefaultRange = normalizeHistoryRange(draft.historyDefaultRange)
      if (historyDefaultRange !== draft.historyDefaultRange) {
        return { error: { key: 'historyDefaultRangeInvalid' } }
      }
      if (cacheText) {
        cacheSeconds = Number(cacheText)
        if (!Number.isFinite(cacheSeconds) || cacheSeconds < 0) return { error: { key: 'cacheSecondsInvalid' } }
      }
      if (intervalText) {
        historyIntervalSeconds = Number(intervalText)
        if (!Number.isFinite(historyIntervalSeconds) || historyIntervalSeconds < 1) {
          return { error: { key: 'historyIntervalInvalid' } }
        }
      }
      if (providersText) {
        try {
          providers = JSON.parse(providersText)
        } catch (failure) {
          return { error: { key: 'providersJsonInvalid', message: failure.message } }
        }
        const valid = providers && typeof providers === 'object' && !Array.isArray(providers)
          && Object.entries(providers).every(([id, entry]) => (
            id.trim() !== '' && entry && typeof entry === 'object' && !Array.isArray(entry)
          ))
        if (!valid) return { error: { key: 'providersInvalid' } }
      }

      if (modulesText) {
        try { providerModules = JSON.parse(modulesText) }
        catch (failure) { return { error: { key: 'providerModulesInvalid', message: failure.message } } }
        if (!Array.isArray(providerModules) || !providerModules.every((value) => typeof value === 'string' && value.trim() !== '')) {
          return { error: { key: 'providerModulesInvalid', message: '' } }
        }
      }

      const fields = [
        ['cacheSeconds', cacheSeconds, cacheText === '', Object.is(current.cacheSeconds ?? 30, cacheSeconds)],
        ['history', draft.history, false, Object.is(current.history !== false, draft.history)],
        ['historyDefaultRange', historyDefaultRange, false, Object.is(normalizeHistoryRange(current.historyDefaultRange), historyDefaultRange)],
        ['historyIntervalSeconds', historyIntervalSeconds, intervalText === '', Object.is(current.historyIntervalSeconds ?? 30, historyIntervalSeconds)],
        ['providers', providers, providersText === '', JSON.stringify(current.providers ?? {}) === JSON.stringify(providers)],
        ['providerModules', providerModules, modulesText === '', JSON.stringify(current.providerModules ?? []) === JSON.stringify(providerModules)],
      ]
      const ops = []
      for (const [path, value, unset, unchanged] of fields) {
        if (unset) {
          if (Object.prototype.hasOwnProperty.call(user, path)) ops.push({ op: 'unset', path: [path] })
        } else if (!unchanged) {
          ops.push({ op: 'set', path: [path], value })
        }
      }
      return { ops }
    }

    function QuotaSettings(props) {
      const tr = props.t
      const describeRef = React.useRef(props.describeSettings)
      const mutateRef = React.useRef(props.mutateSettings)
      describeRef.current = props.describeSettings
      mutateRef.current = props.mutateSettings

      const alive = React.useRef(true)
      const [snapshot, setSnapshot] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState('')

      const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        setNotice('')
        try {
          const value = await remoteResult(() => describeRef.current())
          if (!alive.current) return
          const namespace = value?.namespaces?.find((entry) => entry.ns === NS)
          if (!namespace) {
            setSnapshot(null)
            setDraft(null)
            setError({ key: 'settingsNotFound' })
            return
          }
          setSnapshot({ ...namespace, writable: value.writable !== false })
          setDraft(createSettingsDraft(namespace.value))
        } catch (failure) {
          if (!alive.current) return
          setSnapshot(null)
          setDraft(null)
          setError({ key: 'settingsLoadFailed', message: remoteErrorText(failure) })
        } finally {
          if (alive.current) setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        alive.current = true
        load()
        return () => {
          alive.current = false
        }
      }, [load])

      const disabled = loading || busy || !draft || !snapshot || snapshot.writable === false
      const update = (field, value) => {
        setDraft((current) => ({ ...current, [field]: value }))
        setError(null)
        setNotice('')
      }
      const save = async () => {
        if (disabled) return
        const result = settingsOperations(draft, snapshot)
        if (result.error) {
          setError(result.error)
          setNotice('')
          return
        }
        if (result.ops.length === 0) {
          setError(null)
          setNotice('settingsNoChanges')
          return
        }
        setBusy(true)
        setError(null)
        setNotice('')
        try {
          const value = await remoteResult(() => mutateRef.current(NS, result.ops, snapshot.revision))
          if (!alive.current) return
          setSnapshot((current) => ({ ...current, ...value, writable: current.writable }))
          setDraft(createSettingsDraft(value.value))
          setNotice('settingsSaved')
        } catch (failure) {
          if (!alive.current) return
          if (failure.code === 'SETTINGS_CONFLICT') {
            await load()
            if (alive.current) setError({ key: 'settingsConflict' })
          } else {
            setError({ key: 'settingsSaveFailed', message: remoteErrorText(failure) })
          }
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      const inputStyle = {
        width: '100%',
        maxWidth: 260,
        height: 30,
        boxSizing: 'border-box',
        padding: '0 10px',
        borderRadius: TOKENS.radiusSm,
        border: `1px solid ${TOKENS.inputBorder}`,
        background: TOKENS.input,
        color: TOKENS.textStrong,
        font: 'inherit',
        fontSize: 12,
        outline: 'none',
      }
      const labelStyle = { color: TOKENS.textStrong, fontSize: 12, fontWeight: 500 }
      const hintStyle = { margin: 0, color: TOKENS.textDim, fontSize: 11, lineHeight: '16px' }

      return h('section', {
        style: { display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 12 },
      },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        h('h3', { style: { margin: 0, color: TOKENS.textStrong, fontSize: 13, fontWeight: 600 } }, tr('settingsTitle')),
        h('p', { style: { margin: 0, color: TOKENS.textSecondary, fontSize: 12, lineHeight: '18px' } }, tr('settingsHint'))),
      loading && !draft ? h('p', { style: hintStyle }, tr('settingsLoading')) : null,
      draft ? h(React.Fragment, null,
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('span', { style: labelStyle }, tr('cacheSeconds')),
          h('input', {
            type: 'number', min: 0, step: 'any', value: draft.cacheSeconds, disabled,
            'aria-label': tr('cacheSeconds'),
            onChange: (event) => update('cacheSeconds', event.target.value),
            style: inputStyle,
          }),
          h('p', { style: hintStyle }, tr('cacheSecondsHint'))),
        h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
          h('input', {
            type: 'checkbox', checked: draft.history, disabled,
            'aria-label': tr('historyEnabled'),
            onChange: (event) => update('history', event.target.checked),
            style: { margin: '2px 0 0' },
          }),
          h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h('span', { style: labelStyle }, tr('historyEnabled')),
            h('span', { style: hintStyle }, tr('historyEnabledHint')))),
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('span', { style: labelStyle }, tr('historyDefaultRange')),
          h('select', {
            value: draft.historyDefaultRange, disabled,
            'aria-label': tr('historyDefaultRange'),
            onChange: (event) => update('historyDefaultRange', event.target.value),
            style: inputStyle,
          }, HISTORY_RANGES.map((entry) => h('option', { key: entry.id, value: entry.id }, tr(entry.label)))),
          h('p', { style: hintStyle }, tr('historyDefaultRangeHint'))),
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('span', { style: labelStyle }, tr('historyIntervalSeconds')),
          h('input', {
            type: 'number', min: 1, step: 'any', value: draft.historyIntervalSeconds,
            disabled: disabled || !draft.history,
            'aria-label': tr('historyIntervalSeconds'),
            onChange: (event) => update('historyIntervalSeconds', event.target.value),
            style: inputStyle,
          }),
          h('p', { style: hintStyle }, tr('historyIntervalSecondsHint'))),
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('span', { style: labelStyle }, tr('providersConfig')),
          h('textarea', {
            value: draft.providers, disabled, rows: 8, spellCheck: false,
            'aria-label': tr('providersConfig'),
            onChange: (event) => update('providers', event.target.value),
            style: {
              ...inputStyle,
              maxWidth: 'none',
              height: 'auto',
              minHeight: 160,
              padding: 10,
              fontFamily: 'monospace',
              lineHeight: '18px',
              resize: 'vertical',
            },
          }),
          h('p', { style: hintStyle }, tr('providersConfigHint'))),
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('span', { style: labelStyle }, tr('providerModules')),
          h('textarea', {
            value: draft.providerModules, disabled, rows: 3, spellCheck: false,
            'aria-label': tr('providerModules'),
            onChange: (event) => update('providerModules', event.target.value),
            style: { ...inputStyle, maxWidth: 'none', height: 'auto', padding: 10, fontFamily: 'monospace', resize: 'vertical' },
          }),
          h('p', { style: hintStyle }, tr('providerModulesHint'))),
        h('div', null, h('button', {
          type: 'button', disabled, onClick: save, style: rowButton(disabled, true),
        }, busy ? tr('settingsSaving') : tr('settingsSave')))) : null,
      snapshot?.writable === false ? h('p', { style: hintStyle }, tr('settingsReadOnly')) : null,
      error ? h('p', {
        role: 'alert',
        style: { margin: 0, color: TOKENS.danger, fontSize: 11, lineHeight: '16px' },
      }, tr(error.key, { message: error.message })) : null,
      notice ? h('p', {
        role: 'status',
        style: { margin: 0, color: TOKENS.textSecondary, fontSize: 11, lineHeight: '16px' },
      }, tr(notice)) : null)
    }

    /**
     * Credential fields are supplied by the registered providers; secret values
     * continue through the existing credentials Remote.
     */
    function ProviderCredentialsPage(props) {
      React.useSyncExternalStore(views.subscribe, views.getSnapshot, views.getSnapshot)
      const tr = typeof props.t === 'function' ? props.t : fallbackTranslate
      const credentialProps = {
        t: tr,
        describeCredentials: props.describeCredentials,
        writeCredential: props.writeCredential,
        removeCredential: props.removeCredential,
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8 } },
          h('h3', { style: { margin: 0, color: TOKENS.textStrong, fontSize: 13, fontWeight: 600 } }, tr('credentialsTitle')),
          h('p', { style: { margin: 0, color: TOKENS.textSecondary, fontSize: 12, lineHeight: '18px' } }, tr('credentialsHint')),
          h('p', { style: { margin: 0, color: TOKENS.textDim, fontSize: 11, lineHeight: '16px' } }, tr('credentialsEffective'))),
        views.credentialRows().map((row) => h(CredentialRow, {
          key: row.id,
          ...credentialProps,
          refs: row.refs,
          label: views.text(row.label, tr),
          hint: views.text(row.hint, tr),
          placeholder: views.text(row.placeholder, tr),
        })))
    }

    function PluginConfigPage(props) {
      const tr = typeof props.t === 'function' ? props.t : fallbackTranslate
      return h(React.Fragment, null,
        h(QuotaSettings, {
          t: tr,
          describeSettings: props.describeSettings,
          mutateSettings: props.mutateSettings,
        }),
        h(ProviderCredentialsPage, props))
    }

    function QuotaPill({ useProjection, t }) {
      React.useSyncExternalStore(views.subscribe, views.getSnapshot, views.getSnapshot)
      const tr = typeof t === 'function' ? t : fallbackTranslate
      const selection = useProjection('modelSelection')
      const provider = selection?.next?.provider ?? selection?.lastUsed?.provider ?? ''

      const [state, setState] = React.useState({ data: null, error: false })
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const [hovered, setHovered] = React.useState(false)
      const triggerRef = React.useRef(null)
      const panelRef = React.useRef(null)

      React.useEffect(() => {
        let disposed = false
        let timer = null
        let active = null

        const load = async () => {
          if (active) return
          const controller = new AbortController()
          const abortTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
          const current = { controller, abortTimer }
          active = current
          try {
            const data = await requestQuota(provider, controller.signal)
            if (disposed) return
            if (data.ok === false && data.reason === 'error') {
              // Transient failure: keep whatever payload (a success or an
              // actionable terminal state like missing-credential) is on
              // screen and mark it stale instead of clobbering it.
              setState((previous) => previous.data
                ? { data: { ...previous.data, stale: true }, error: false }
                : { data, error: false })
            } else {
              setState({ data, error: false })
            }
          } catch {
            if (!disposed) {
              setState((previous) => previous.data
                ? { data: { ...previous.data, stale: true }, error: false }
                : { data: null, error: true })
            }
          } finally {
            clearTimeout(abortTimer)
            if (active === current) active = null
          }
        }

        setState({ data: null, error: false })
        load()
        timer = setInterval(load, REFRESH_MS)
        return () => {
          disposed = true
          if (timer) clearInterval(timer)
          if (active) {
            clearTimeout(active.abortTimer)
            active.controller.abort()
            active = null
          }
        }
      }, [provider])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (panelRef.current?.contains(event.target)) return
          if (triggerRef.current?.contains(event.target)) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onResize = () => setOpen(false)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        window.addEventListener('resize', onResize)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('resize', onResize)
        }
      }, [open])

      const data = state.data
      if (data && data.ok === false && data.reason === 'unsupported') return null
      if (!data && !state.error) return null

      const label = compactLabel(data, tr)
      const icon = providerGauge(data) ? h(GaugeIcon) : h(CoinIcon)

      const togglePanel = () => {
        if (open) {
          setOpen(false)
          return
        }
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return
        setAnchor({ left: rect.left, top: rect.top })
        setOpen(true)
      }

      const renderRows = () => {
        if (!data || data.ok === false) {
          return h('div', { style: { color: TOKENS.textSecondary, padding: '2px 0' } }, errorLabel(data, tr))
        }
        return rowSpecsOf(data, tr).map((spec) => detailRow(spec.label, spec.value, spec.note))
      }

      const renderPanel = () => {
        if (!anchor) return null
        const width = Math.min(PANEL_WIDTH, Math.max(240, window.innerWidth - 16))
        const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
        const bottom = Math.max(8, window.innerHeight - anchor.top + 10)

        return ReactDOM.createPortal(h('div', {
          ref: panelRef,
          role: 'dialog',
          'aria-label': tr('details'),
          style: {
            position: 'fixed',
            left,
            bottom,
            width,
            zIndex: 2147483000,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: '60vh',
            overflowY: 'auto',
            padding: '12px 14px',
            background: TOKENS.panel,
            color: TOKENS.textSecondary,
            border: `0.5px solid ${TOKENS.border}`,
            borderRadius: TOKENS.radius,
            boxShadow: TOKENS.shadow,
            backdropFilter: TOKENS.backdrop,
            WebkitBackdropFilter: TOKENS.backdrop,
            fontSize: 12,
            lineHeight: '18px',
          },
        },
        h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingBottom: 8,
            borderBottom: `0.5px solid ${TOKENS.border}`,
          },
        },
        h('span', { style: { color: TOKENS.textStrong, fontSize: 13, fontWeight: 500 } }, panelTitle(data, tr)),
        data?.stale ? h('span', { style: { color: TOKENS.textDim, fontSize: 11 } }, tr('stale')) : null),
        renderRows(),
        h(QuotaHistory, { key: provider, provider, tr }),
        data?.updatedAt ? h('div', {
          style: {
            paddingTop: 8,
            borderTop: `0.5px solid ${TOKENS.border}`,
            color: TOKENS.textDim,
            fontSize: 11,
          },
        }, tr('updatedAt', { time: absoluteTime(Date.parse(data.updatedAt)) })) : null), document.body)
      }

      return h(React.Fragment, null,
        h('span', {
          style: {
            minWidth: 0,
            display: 'inline-flex',
            fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
            lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
          },
        },
        h('button', {
          ref: triggerRef,
          type: 'button',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': tr('title'),
          title: label,
          onClick: togglePanel,
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: '100%',
            padding: '1px 8px',
            border: 'none',
            borderRadius: TOKENS.radiusSm,
            background: hovered || open ? TOKENS.hover : 'transparent',
            color: hovered || open ? TOKENS.textSecondary : TOKENS.text,
            font: 'inherit',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          },
        },
        icon,
        h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, label))),
        open ? renderPanel() : null)
    }

    return {
      inject: ['slots', 'locale'],
      __test: {
        QuotaHistory,
        createViewEngine,
        normalizeHistoryRange,
        requestDictionaries,
        requestQuotaHistory,
        createSettingsDraft,
        settingsOperations,
        compactLabel,
        badgeText,
        panelTitle,
        errorLabel,
        rowSpecsOf,
        providerGauge,
        viewOf: views.viewOf,
        views,
        installModelBadges,
        requestViews,
      },
      apply(ctx) {
        ctx.effect(() => {
          let disposed = false
          let retryTimer = null
          let request = null
          const syncLocale = () => views.setLanguage(
            ctx.locale?.getLocale?.().active ?? ctx.locale?.getSnapshot?.().active ?? window.navigator?.language,
          )
          const load = async () => {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
            request = { controller, timeout }
            try {
              const manifest = await requestViews(controller.signal)
              if (disposed) return
              views.setManifest(manifest)
              syncLocale()
            } catch {
              if (!disposed) retryTimer = setTimeout(() => { void load() }, RETRY_MS)
            } finally {
              clearTimeout(timeout)
              if (request?.controller === controller) request = null
            }
          }
          syncLocale()
          const unsubscribe = typeof ctx.locale?.subscribe === 'function' ? ctx.locale.subscribe(syncLocale) : undefined
          void load()
          return () => {
            disposed = true
            unsubscribe?.()
            if (retryTimer !== null) clearTimeout(retryTimer)
            request?.controller.abort()
          }
        }, 'llm-quota: provider views')
        // Message dictionaries live in the bundle's `locale/*.json` and arrive
        // through the Host i18n route. Registering after mount is safe: the
        // locale service bumps its revision and slot-rendered copy updates
        // without a remount. Transient failures retry until the dictionaries land.
        ctx.effect(() => {
          let disposed = false
          let unregister = null
          let retryTimer = null
          let request = null
          const load = async () => {
            let dictionaries
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
            request = { controller, timeout }
            try {
              dictionaries = await requestDictionaries(controller.signal)
            } catch {
              if (!disposed) retryTimer = setTimeout(() => { void load() }, RETRY_MS)
              return
            } finally {
              clearTimeout(timeout)
              if (request?.controller === controller) request = null
            }
            if (disposed) return
            messages = dictionaries
            try {
              unregister = ctx.locale.register(NS, dictionaries)
            } catch (error) {
              console.error('llm-quota: dictionary registration failed:', error)
            }
          }
          void load()
          return () => {
            disposed = true
            if (retryTimer !== null) clearTimeout(retryTimer)
            request?.controller.abort()
            try { unregister?.() } catch {}
          }
        }, 'llm-quota: dictionary')
        ctx.effect(() => {
          let tr = fallbackTranslate
          try {
            if (typeof ctx.locale?.bind === 'function') tr = ctx.locale.bind(NS)
          } catch {}
          return installModelBadges(ctx.locale, tr)
        }, 'llm-quota: model badges')
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'llm-quota',
          order: 2,
          locale: NS,
        }, QuotaPill))
        // Kept optional: the quota pill must keep working on a deployment that
        // mounts no credentials Remote. The page registers only while the
        // Plugins page declares its bundle-configuration slot.
        ctx.inject(['slots', 'remote', 'remote.credentials', 'remote.settings'], (scope) => {
          scope.slots.inject('plugins.bundle.config', () => scope.slots.register({
            name: 'plugins.bundle.config',
            key: PACKAGE,
            locale: NS,
            inject: () => ({
              describeCredentials: (refs) => scope.remote.credentials.describe(refs),
              writeCredential: (ref, value) => scope.remote.credentials.set(ref, value),
              removeCredential: (ref) => scope.remote.credentials.unset(ref),
              describeSettings: () => scope.remote.settings.describe(),
              mutateSettings: (ns, ops, revision) => scope.remote.settings.mutate(ns, ops, revision),
            }),
          }, PluginConfigPage))
        })
      },
    }
  },
})
