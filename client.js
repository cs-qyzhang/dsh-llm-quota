window.__ModuleLoader__.load({
  id: '@local/dsh-llm-quota',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'llm-quota'
    const REFRESH_MS = 60_000
    const FETCH_TIMEOUT_MS = 8_000
    const PANEL_WIDTH = 296

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
        mimoPlanLeft: '套餐剩 {percent}%',
        mimoBalance: '剩余余额',
        mimoCash: '现金余额',
        mimoGift: '赠送余额',
        mimoFrozen: '冻结金额',
        mimoPlan: 'Token Plan',
        mimoMonth: '本月用量',
        mimoCompensation: '补偿积分',
        mimoUsed: '已用 {used} / {limit}（{percent}%）',
        openrouterRemaining: '剩余额度',
        openrouterCredits: '已购买额度',
        openrouterUsage: '已使用',
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
        mimoPlanLeft: 'Plan {percent}% left',
        mimoBalance: 'Remaining balance',
        mimoCash: 'Cash balance',
        mimoGift: 'Bonus balance',
        mimoFrozen: 'Frozen funds',
        mimoPlan: 'Token Plan',
        mimoMonth: 'This month',
        mimoCompensation: 'Compensation credits',
        mimoUsed: '{used} / {limit} ({percent}% used)',
        openrouterRemaining: 'Credits remaining',
        openrouterCredits: 'Credits purchased',
        openrouterUsage: 'Usage',
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

    function formatAmount(currency, amount) {
      const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
      const value = typeof amount === 'number' ? amount : Number.parseFloat(amount)
      if (!Number.isFinite(value)) return `${symbol}${amount ?? ''}`.trim()
      return `${symbol}${value.toFixed(2)}`
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
      if (data.kind === 'balance' || data.kind === 'openrouter') {
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
      const parts = []
      if (data.fiveHour) parts.push(tr('fiveHour', { percent: data.fiveHour.remainingPercent }))
      if (data.weekly) parts.push(tr('weekly', { percent: data.weekly.remainingPercent }))
      return parts.length > 0 ? parts.join(' · ') : tr('error')
    }

    function panelTitle(data, tr) {
      if (!data || data.ok === false) return tr('title')
      if (data.kind === 'glm') return data.level ? `GLM ${capitalise(data.level)}` : 'GLM'
      if (data.kind === 'kimi') return 'Kimi'
      if (data.kind === 'openrouter') return 'OpenRouter'
      if (data.kind === 'minimax') {
        return data.model ? `MiniMax · ${data.model}` : 'MiniMax'
      }
      if (data.kind === 'xiaomi-mimo') {
        return data.plan?.name ? `${tr('mimoTitle')} · ${data.plan.name}` : tr('mimoTitle')
      }
      return tr('balanceTitle')
    }

    function errorLabel(data, tr) {
      if (!data) return tr('error')
      if (data.reason === 'missing-credential') return tr('missingCredential')
      if (data.reason === 'missing-cookie') return tr('missingCookie')
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
            const query = provider ? `?provider=${encodeURIComponent(provider)}` : ''
            const response = await fetch(`/api/llm-quota${query}`, {
              signal: controller.signal,
              headers: { Accept: 'application/json' },
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const data = await response.json()
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
              throw new Error('invalid quota response')
            }
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
      const isPlan = data && (data.kind === 'glm' || data.kind === 'kimi' || data.kind === 'minimax' || data.kind === 'xiaomi-mimo')
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
        if (data.kind === 'openrouter') {
          const rows = []
          if (data.amount !== undefined) {
            rows.push(detailRow(tr('openrouterRemaining'), formatAmount(data.currency, data.amount)))
          }
          if (data.totalCredits !== undefined) {
            rows.push(detailRow(tr('openrouterCredits'), formatAmount(data.currency, data.totalCredits)))
          }
          if (data.totalUsage !== undefined) {
            rows.push(detailRow(tr('openrouterUsage'), formatAmount(data.currency, data.totalUsage)))
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
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'llm-quota',
          order: 2,
          locale: NS,
        }, QuotaPill))
      },
    }
  },
})
