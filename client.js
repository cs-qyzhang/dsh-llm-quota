window.__ModuleLoader__.load({
  id: '@local/dsh-llm-quota',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'llm-quota'
    const PACKAGE = '@local/dsh-llm-quota'
    const REFRESH_MS = 60_000
    const FETCH_TIMEOUT_MS = 8_000
    const RETRY_MS = 30_000
    const SCAN_DELAY_MS = 250
    const PANEL_WIDTH = 296

    // Credential references the provider adapters resolve, primary name first.
    // The aliases keep parity with providers/qwen.js and providers/xiaomi-mimo.js.
    const MIMO_REFS = ['MIMO_COOKIE', 'XIAOMI_MIMO_COOKIE']
    const QWEN_REFS = ['QWEN_CONSOLE_TOKEN', 'BAILIAN_CONSOLE_TOKEN']

    const DICT = {
      zh: {
        title: '模型额度',
        details: '模型额度详情',
        balance: '余额 {amount}',
        balanceTitle: 'DeepSeek 余额',
        fiveHour: '5h 剩 {percent}%',
        weekly: '周 剩 {percent}%',
        fiveHourName: '5 小时额度',
        weeklyName: '周额度',
        remaining: '剩余 {percent}%',
        resetsIn: '{time} 后重置',
        resetsAt: '{time} 重置',
        toppedUp: '充值余额',
        bonus: '赠送余额',
        status: '状态',
        available: '可用',
        insufficient: '余额不足',
        updatedAt: '更新于 {time}',
        stale: '数据可能已过期',
        error: '额度暂不可用',
        missingCredential: '未配置 API Key',
        missingCookie: '未配置 MiMo 控制台 Cookie',
        signedOut: '请先登录 DeepSeek',
        mimoTitle: 'Xiaomi MiMo',
        mimoPayg: '按量计费',
        mimoTokenPlan: 'Token Plan',
        mimoPlanLeft: '套餐剩 {percent}%',
        mimoBalance: '剩余余额',
        mimoCash: '现金余额',
        mimoGift: '赠送余额',
        mimoFrozen: '冻结金额',
        mimoPlan: 'Token Plan',
        mimoMonth: '本月用量',
        mimoCompensation: '补偿积分',
        mimoUsed: '已用 {used} / {limit}（{percent}%）',
        moonshotTitle: 'Moonshot',
        qwenTitle: 'Qwen',
        qwenTokenPlan: 'Token Plan',
        qwenMonthly: '月度额度',
        qwenPlanLeft: '套餐剩 {percent}%',
        missingConsoleToken: '未配置 Qwen 控制台 Token',
        creditsRemaining: '剩余额度',
        creditsPurchased: '已购买额度',
        creditsUsed: '已使用',
        badgeFiveHour: '5h {percent}%',
        badgeWeekly: '周 {percent}%',
        badgePlan: '套餐 {percent}%',
        credentialsTitle: '供应商额外凭证',
        credentialsHint: '部分供应商除推理 Key 外还需要一份控制台凭证才能读取额度。值只写入 Host 凭据库，不会回传浏览器。',
        credentialsEffective: '保存后在下一次额度刷新时生效（最长约 60 秒）。',
        mimoCookie: 'Xiaomi MiMo 控制台 Cookie',
        mimoCookieHint: '用于 xiaomi 与 xiaomi-token-plan 供应商。登录 platform.xiaomimimo.com 后，从任意 /api/v1/ 请求复制完整 Cookie，至少包含 serviceToken 与 userId。',
        mimoCookiePlaceholder: 'serviceToken=...; userId=...',
        qwenToken: 'Qwen 控制台 Access Token',
        qwenTokenHint: '用于 qwen-token-plan 供应商。执行 bl auth login --console 后，从 ~/.bailian/config.json 复制 access_token。',
        qwenTokenPlaceholder: '粘贴控制台 access_token',
        credentialConfigured: '已配置',
        credentialNotConfigured: '未配置',
        credentialVia: '已配置（{ref}）',
        credentialSource: '来源：{source}',
        credentialReadOnly: '该凭证由当前配置层提供，无法在此修改。',
        credentialLoading: '读取中…',
        credentialSave: '保存',
        credentialSaving: '保存中…',
        credentialClear: '清除',
        credentialClearing: '清除中…',
        credentialShow: '显示',
        credentialHide: '隐藏',
        credentialSaved: '已保存，将在下一次额度刷新时生效。',
        credentialEmpty: '请输入凭证内容。',
        credentialSaveFailed: '保存失败：{message}',
        credentialClearFailed: '清除失败：{message}',
        credentialLoadFailed: '无法读取凭证状态：{message}',
      },
      en: {
        title: 'Model quota',
        details: 'Model quota details',
        balance: 'Balance {amount}',
        balanceTitle: 'DeepSeek balance',
        fiveHour: '5h {percent}% left',
        weekly: 'Week {percent}% left',
        fiveHourName: '5-hour quota',
        weeklyName: 'Weekly quota',
        remaining: '{percent}% left',
        resetsIn: 'Resets in {time}',
        resetsAt: 'Resets {time}',
        toppedUp: 'Topped-up balance',
        bonus: 'Bonus balance',
        status: 'Status',
        available: 'Available',
        insufficient: 'Insufficient',
        updatedAt: 'Updated {time}',
        stale: 'Data may be stale',
        error: 'Quota unavailable',
        missingCredential: 'API key not configured',
        missingCookie: 'MiMo console cookie not configured',
        signedOut: 'Sign in to DeepSeek',
        mimoTitle: 'Xiaomi MiMo',
        mimoPayg: 'Pay as you go',
        mimoTokenPlan: 'Token Plan',
        mimoPlanLeft: 'Plan {percent}% left',
        mimoBalance: 'Remaining balance',
        mimoCash: 'Cash balance',
        mimoGift: 'Bonus balance',
        mimoFrozen: 'Frozen funds',
        mimoPlan: 'Token Plan',
        mimoMonth: 'This month',
        mimoCompensation: 'Compensation credits',
        mimoUsed: '{used} / {limit} ({percent}% used)',
        moonshotTitle: 'Moonshot',
        qwenTitle: 'Qwen',
        qwenTokenPlan: 'Token Plan',
        qwenMonthly: 'Monthly quota',
        qwenPlanLeft: 'Plan {percent}% left',
        missingConsoleToken: 'Qwen console token not configured',
        creditsRemaining: 'Credits remaining',
        creditsPurchased: 'Credits purchased',
        creditsUsed: 'Usage',
        badgeFiveHour: '5h {percent}%',
        badgeWeekly: 'Wk {percent}%',
        badgePlan: 'Plan {percent}%',
        credentialsTitle: 'Provider credentials',
        credentialsHint: 'Some providers need an extra console credential, beyond the inference key, to read quota. Values are stored in the Host credential store and never returned to the browser.',
        credentialsEffective: 'Changes take effect on the next quota refresh (up to 60 seconds).',
        mimoCookie: 'Xiaomi MiMo console cookie',
        mimoCookieHint: 'Used by the xiaomi and xiaomi-token-plan providers. Sign in to platform.xiaomimimo.com, copy the full Cookie header from any /api/v1/ request, and keep at least serviceToken and userId.',
        mimoCookiePlaceholder: 'serviceToken=...; userId=...',
        qwenToken: 'Qwen console access token',
        qwenTokenHint: 'Used by qwen-token-plan providers. Run bl auth login --console and copy access_token from ~/.bailian/config.json.',
        qwenTokenPlaceholder: 'Paste the console access_token',
        credentialConfigured: 'Configured',
        credentialNotConfigured: 'Not configured',
        credentialVia: 'Configured ({ref})',
        credentialSource: 'Source: {source}',
        credentialReadOnly: 'This credential comes from the current configuration layer and cannot be changed here.',
        credentialLoading: 'Reading…',
        credentialSave: 'Save',
        credentialSaving: 'Saving…',
        credentialClear: 'Clear',
        credentialClearing: 'Clearing…',
        credentialShow: 'Show',
        credentialHide: 'Hide',
        credentialSaved: 'Saved. It takes effect on the next quota refresh.',
        credentialEmpty: 'Enter a credential value.',
        credentialSaveFailed: 'Could not save: {message}',
        credentialClearFailed: 'Could not clear: {message}',
        credentialLoadFailed: 'Could not read credential status: {message}',
      },
    }

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

    function fallbackTranslate(key, params) {
      const template = DICT.en[key] ?? key
      return template.replace(/\{(\w+)\}/g, (_, name) => (
        params && params[name] !== undefined ? String(params[name]) : `{${name}}`
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

    /** Resolve a credential Remote call as a result, or throw its error. */
    async function credentialResult(call) {
      const response = await call()
      if (!response || response.ok !== true) throw new Error(remoteErrorText(response?.error))
      return response.value
    }

    function formatAmount(currency, amount) {
      const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
      const value = typeof amount === 'number' ? amount : Number.parseFloat(amount)
      if (!Number.isFinite(value)) return `${symbol}${amount ?? ''}`.trim()
      return `${symbol}${value.toFixed(2)}`
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

    function capitalise(value) {
      return typeof value === 'string' && value.length > 0
        ? value[0].toUpperCase() + value.slice(1)
        : value
    }

    function relativeDuration(milliseconds) {
      const hours = Math.floor(milliseconds / 3_600_000)
      const minutes = Math.max(1, Math.floor((milliseconds % 3_600_000) / 60_000))
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
    }

    function absoluteTime(time) {
      return new Date(time).toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
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

    function compactLabel(data, tr) {
      if (!data || data.ok === false) return tr('error')
      if (data.kind === 'balance' || data.kind === 'openrouter' || data.kind === 'vercel-gateway') {
        return tr('balance', { amount: formatAmount(data.currency, data.amount) })
      }
      if (data.kind === 'xiaomi-mimo') {
        const mimoParts = []
        if (data.amount !== undefined) {
          mimoParts.push(tr('balance', { amount: formatAmount(data.currency, data.amount) }))
        }
        if (data.plan && Number.isFinite(data.plan.remainingPercent)) {
          mimoParts.push(tr('mimoPlanLeft', { percent: data.plan.remainingPercent }))
        }
        return mimoParts.length > 0 ? mimoParts.join(' · ') : tr('error')
      }
      if (data.kind === 'qwen') {
        return data.plan && Number.isFinite(data.plan.remainingPercent)
          ? tr('qwenPlanLeft', { percent: data.plan.remainingPercent })
          : tr('error')
      }
      const parts = []
      if (data.fiveHour) parts.push(tr('fiveHour', { percent: data.fiveHour.remainingPercent }))
      if (data.weekly) parts.push(tr('weekly', { percent: data.weekly.remainingPercent }))
      return parts.length > 0 ? parts.join(' · ') : tr('error')
    }

    function badgeText(data, tr) {
      if (!data || data.ok !== true) return ''
      if (data.kind === 'balance' || data.kind === 'openrouter' || data.kind === 'vercel-gateway') {
        return formatAmount(data.currency, data.amount)
      }
      if (data.kind === 'xiaomi-mimo') {
        const parts = []
        if (data.amount !== undefined) parts.push(formatAmount(data.currency, data.amount))
        if (data.plan && Number.isFinite(data.plan.remainingPercent)) {
          parts.push(tr('badgePlan', { percent: data.plan.remainingPercent }))
        }
        return parts.join(' · ')
      }
      if (data.kind === 'qwen') {
        return data.plan && Number.isFinite(data.plan.remainingPercent)
          ? tr('badgePlan', { percent: data.plan.remainingPercent })
          : ''
      }
      const parts = []
      if (data.fiveHour && Number.isFinite(data.fiveHour.remainingPercent)) {
        parts.push(tr('badgeFiveHour', { percent: data.fiveHour.remainingPercent }))
      }
      if (data.weekly && Number.isFinite(data.weekly.remainingPercent)) {
        parts.push(tr('badgeWeekly', { percent: data.weekly.remainingPercent }))
      }
      return parts.join(' · ')
    }

    function panelTitle(data, tr) {
      if (!data || data.ok === false) return tr('title')
      if (data.kind === 'balance') {
        return data.service === 'moonshot' ? tr('moonshotTitle') : tr('balanceTitle')
      }
      if (data.kind === 'glm') return data.level ? `GLM ${capitalise(data.level)}` : 'GLM'
      if (data.kind === 'kimi') return 'Kimi'
      if (data.kind === 'openrouter') return 'OpenRouter'
      if (data.kind === 'vercel-gateway') return 'Vercel AI Gateway'
      if (data.kind === 'minimax') {
        return data.model ? `MiniMax · ${data.model}` : 'MiniMax'
      }
      if (data.kind === 'xiaomi-mimo') {
        if (data.mode === 'balance') return `${tr('mimoTitle')} · ${tr('mimoPayg')}`
        if (data.mode === 'plan') {
          return data.plan?.name
            ? `${tr('mimoTitle')} · ${tr('mimoTokenPlan')} (${data.plan.name})`
            : `${tr('mimoTitle')} · ${tr('mimoTokenPlan')}`
        }
        return data.plan?.name ? `${tr('mimoTitle')} · ${data.plan.name}` : tr('mimoTitle')
      }
      if (data.kind === 'qwen') return `${tr('qwenTitle')} · ${tr('qwenTokenPlan')}`
      return tr('balanceTitle')
    }

    function errorLabel(data, tr) {
      if (!data) return tr('error')
      if (data.reason === 'missing-credential') return tr('missingCredential')
      if (data.reason === 'missing-cookie') return tr('missingCookie')
      if (data.reason === 'missing-console-token') return tr('missingConsoleToken')
      if (data.reason === 'signed-out') return tr('signedOut')
      return tr('error')
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

    function installModelBadges(locale, tr) {
      if (typeof document === 'undefined' || !document.head || typeof MutationObserver === 'undefined') {
        return () => {}
      }

      const style = document.createElement('style')
      style.id = 'llm-quota-model-badges'
      style.dataset.plugin = '@local/dsh-llm-quota'
      document.head.appendChild(style)

      const feed = new Map()
      let disposed = false
      let scanTimer = null
      let refreshTimer = null
      let stopLocale = null

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
      } catch {}

      scan()
      render()
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
          const value = await credentialResult(() => describeRef.current(refs))
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
          await credentialResult(() => writeRef.current(refs[0], draft))
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
        if (disabled || !clearable) return
        setBusy('clear')
        setError(null)
        setNotice('')
        try {
          for (const ref of configuredRefs) {
            if (views?.[ref]?.writable === false) continue
            await credentialResult(() => removeRef.current(ref))
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
          disabled: disabled || !clearable || busy !== '',
          onClick: clear,
          style: rowButton(disabled || !clearable || busy !== '', false),
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

    /**
     * Bundle configuration page: the console credentials that providers such as
     * Xiaomi MiMo and Qwen Token Plan need in addition to their inference key.
     */
    function ProviderCredentialsPage(props) {
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
        h(CredentialRow, {
          ...credentialProps,
          refs: MIMO_REFS,
          label: tr('mimoCookie'),
          hint: tr('mimoCookieHint'),
          placeholder: tr('mimoCookiePlaceholder'),
        }),
        h(CredentialRow, {
          ...credentialProps,
          refs: QWEN_REFS,
          label: tr('qwenToken'),
          hint: tr('qwenTokenHint'),
          placeholder: tr('qwenTokenPlaceholder'),
        }))
    }

    function QuotaPill({ useProjection, t }) {
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
              setState((previous) => previous.data?.ok === true
                ? { data: { ...previous.data, stale: true }, error: false }
                : { data, error: false })
            } else {
              setState({ data, error: false })
            }
          } catch {
            if (!disposed) {
              setState((previous) => previous.data?.ok === true
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
      const isPlan = data && (
        data.kind === 'glm'
        || data.kind === 'kimi'
        || data.kind === 'minimax'
        || data.kind === 'qwen'
        || (data.kind === 'xiaomi-mimo' && data.mode !== 'balance')
      )
      const icon = isPlan ? h(GaugeIcon) : h(CoinIcon)

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
        if (data.kind === 'balance') {
          const rows = []
          const wallets = Array.isArray(data.wallets) ? data.wallets : []
          for (const wallet of wallets) {
            rows.push(detailRow(tr('toppedUp'), formatAmount(wallet.currency, wallet.balance)))
          }
          const bonuses = Array.isArray(data.bonusWallets) ? data.bonusWallets : []
          for (const wallet of bonuses) {
            if (Number.parseFloat(wallet.balance) > 0) {
              rows.push(detailRow(tr('bonus'), formatAmount(wallet.currency, wallet.balance)))
            }
          }
          if (typeof data.available === 'boolean') {
            rows.push(detailRow(tr('status'), data.available ? tr('available') : tr('insufficient')))
          }
          return rows
        }
        if (data.kind === 'qwen') {
          const rows = []
          if (data.plan && Number.isFinite(data.plan.remainingPercent)) {
            rows.push(detailRow(tr('qwenMonthly'), formatWindow(data.plan, tr), resetLabel(data.plan.resetAt, tr)))
          }
          return rows
        }
        if (data.kind === 'xiaomi-mimo') {
          const rows = []
          if (data.amount !== undefined) {
            rows.push(detailRow(tr('mimoBalance'), formatAmount(data.currency, data.amount)))
          }
          if (data.cashBalance !== undefined) {
            rows.push(detailRow(tr('mimoCash'), formatAmount(data.currency, data.cashBalance)))
          }
          if (Number.parseFloat(data.giftBalance) > 0) {
            rows.push(detailRow(tr('mimoGift'), formatAmount(data.currency, data.giftBalance)))
          }
          if (Number.parseFloat(data.frozenBalance) > 0) {
            rows.push(detailRow(tr('mimoFrozen'), formatAmount(data.currency, data.frozenBalance)))
          }
          const planRows = [
            [tr('mimoPlan'), data.plan],
            [tr('mimoMonth'), data.plan?.month],
            [tr('mimoCompensation'), data.plan?.compensation],
          ]
          for (const [label, window] of planRows) {
            if (!window || !Number.isFinite(window.remainingPercent)) continue
            rows.push(detailRow(label, formatWindow(window, tr), resetLabel(window.resetAt, tr)))
          }
          return rows
        }
        if (data.kind === 'openrouter' || data.kind === 'vercel-gateway') {
          const rows = []
          if (data.amount !== undefined) {
            rows.push(detailRow(tr('creditsRemaining'), formatAmount(data.currency, data.amount)))
          }
          if (data.totalCredits !== undefined) {
            rows.push(detailRow(tr('creditsPurchased'), formatAmount(data.currency, data.totalCredits)))
          }
          if (data.totalUsage !== undefined) {
            rows.push(detailRow(tr('creditsUsed'), formatAmount(data.currency, data.totalUsage)))
          }
          return rows
        }
        const rows = []
        if (data.fiveHour) {
          rows.push(detailRow(
            tr('fiveHourName'),
            tr('remaining', { percent: data.fiveHour.remainingPercent }),
            resetLabel(data.fiveHour.resetAt, tr),
          ))
        }
        if (data.weekly) {
          rows.push(detailRow(
            tr('weeklyName'),
            tr('remaining', { percent: data.weekly.remainingPercent }),
            resetLabel(data.weekly.resetAt, tr),
          ))
        }
        return rows
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
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'llm-quota: dictionary')
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
        ctx.inject(['slots', 'remote', 'remote.credentials'], (scope) => {
          scope.slots.inject('plugins.bundle.config', () => scope.slots.register({
            name: 'plugins.bundle.config',
            key: PACKAGE,
            locale: NS,
            inject: () => ({
              describeCredentials: (refs) => scope.remote.credentials.describe(refs),
              writeCredential: (ref, value) => scope.remote.credentials.set(ref, value),
              removeCredential: (ref) => scope.remote.credentials.unset(ref),
            }),
          }, ProviderCredentialsPage))
        })
      },
    }
  },
})
