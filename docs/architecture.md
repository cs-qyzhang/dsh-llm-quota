# 架构与实现

本文说明 dsh-llm-quota 的 Host/Client 两半如何协作，以及改动时需要注意的边界。

## 总览

```text
浏览器
  QuotaPill (conversation.composer.dock, order: 2)
    │  useProjection('modelSelection') → provider
    │  GET /api/llm-quota?provider=...
    ▼
DSH Connection（Host/Origin 检查 + 登录认证）
    ▼
dsh Host
  路由 /api/llm-quota
    │  LLM directory + Loader 实时配置 → apiKeyEnv / nativeAuth.env / baseURL
    │  已知 HTTPS 主机 → 固定额度端点
    ├─ deepseek-account → ctx.deepseekAccount.getBalance()
    ├─ DeepSeek API Key → GET api.deepseek.com/user/balance
    ├─ Z.AI / 智谱      → GET <对应主机>/api/monitor/usage/quota/limit
    ├─ Kimi Coding      → GET api.kimi.com/coding/v1/usages
    ├─ MiniMax Plan     → GET api.minimax.io|api.minimaxi.com/v1/token_plan/remains
    ├─ OpenRouter       → GET openrouter.ai/api/v1/credits
    └─ Xiaomi MiMo      → GET platform.xiaomimimo.com/api/v1/{balance,tokenPlan/usage}
    │  ctx.credentials.resolve(<实时凭证引用>)
    │  配置指纹 + 30 秒成功缓存 + 单飞 + 50 条 LRU
    ▼
  JSON 额度结果
```

密钥只经过 Host；浏览器只收到额度数字。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `package.json` | bundle 清单；`dsh.bundle.patch` 指向补丁；`dsh.client` 声明 Web 客户端、激活顺序和依赖 |
| `cordis.patch.yml` | 插入 `id: llm-quota` 的 Host 插件行 |
| `index.js` | Host 插件入口：注册 Connection 认证路由、缓存/单飞、错误归一化；供应商细节委托给 `providers/` |
| `providers/index.js` | 适配器注册表：已知主机 → 额度端点映射、按 `kind` 分发 `readQuota` |
| `providers/resolve.js` | 读取 DSH 实时 provider 配置，把 provider id 解析成额度路由（含 `config.providers` 覆盖） |
| `providers/shared.js` | 适配器共享工具：凭证读取、上游 HTTP、缓存指纹、统一响应片段 |
| `providers/*.js` | 单个额度体系适配器（`account`、`deepseek`、`glm`、`kimi`、`minimax`、`openrouter`、`xiaomi-mimo`） |
| `client.js` | Client 插件：注册 locale 字典、向 composer dock 注册条目、模型选择标签/分组标题的额度装饰、轮询、渲染浮层 |
| `locale/*.json` | 插件管理页使用的标题/描述元数据 |
| `icon.svg` | 插件图标 |

## 渲染位置

`conversation.composer.dock` 是 ui-conversation 声明的 `list` 类型 slot，作用域为 `session`。它被渲染在输入卡片正下方的 `.dock` 行里，后面紧跟 ContextMeter。

现有条目：

| 条目 | 注册方 | order |
| --- | --- | --- |
| 轮次/步数/速度 | ui-chat | 0 |
| token 用量/缓存命中 | ui-chat | 1 |
| 模型额度 | 本插件 | 2 |

因此额度条目出现在「缓存命中」和上下文百分比之间。不要尝试用绝对定位去贴状态行；选择已有 slot 是唯一稳定的位置来源。

## Host 侧

### 激活

```js
export const inject = ['connection', 'credentials', 'llm', 'loader']
export function apply(ctx, config) { ... }
```

- `connection` 提供 `ctx.connection.fetch.register()`，以 `path: '/api/llm-quota'`、`methods: ['GET']` 注册认证 exact Fetch 路由。
- `llm` 提供激活 provider 列表和 configurable-provider directory；`loader` 提供对应插件 entry 的实时 `fiber.config`。
- `credentials` 提供 `ctx.credentials.resolve(name)`，按实时引用名读取密钥。
- DeepSeek 账号服务通过 `ctx.get('deepseekAccount')` 惰性获取，缺少该服务时只让对应 provider 返回 `unavailable`，不影响插件整体激活。

### 请求流程

1. 读取 `provider` 查询参数；为空时回退到 `ctx.get('agentDefaultModel').currentSelection().provider`，再回退到 `deepseek-account`。
2. `config.providers` 精确覆盖优先；否则要求 provider 已在 DSH 激活，并从 LLM directory 与 Loader entry 读取实时配置。
3. pi-ai 使用显式 `profile.apiKeyEnv ?? directory.nativeAuth.env` 与 `profile.baseURL ?? directory.defaultBaseURL`；DeepSeek API Key 使用自身实时 config 和 `DEEPSEEK_BASE_URL` 回退。
4. 只把已知 HTTPS 主机映射到固定额度端点；Moonshot、OAuth-only、未知代理和未激活路由不发起上游请求。
5. 用 `provider + kind + endpoint + keyNames` 生成不含秘密的配置指纹，命中 30 秒成功缓存则直接返回。
6. 未命中时共享同指纹的 pending Promise；成功后写入最多 50 条的 LRU，终态失败不写缓存并删除同键旧值。
7. 临时异常不写缓存；如果有旧成功值，返回旧值并加 `stale: true`，否则返回 `ok: false` 和失败原因。
8. 每次 `readQuota`（含凭证解析、DSH 账号服务与上游 HTTP）有 5 秒总超时；超时按临时失败处理，返回旧成功值并标记 `stale`，或返回 `reason: 'error'`。

### 响应形状

余额型：

```json
{
  "ok": true,
  "provider": "deepseek-account",
  "kind": "balance",
  "currency": "CNY",
  "amount": "65.2768280200000000",
  "wallets": [{ "currency": "CNY", "balance": "65.2768280200000000" }],
  "bonusWallets": [{ "currency": "CNY", "balance": "0" }],
  "updatedAt": "2026-10-24T10:34:09.837Z"
}
```

Coding Plan 型：

```json
{
  "ok": true,
  "provider": "kimi-coding",
  "kind": "kimi",
  "fiveHour": { "usedPercent": 100, "remainingPercent": 0, "resetAt": "2026-10-24T11:30:21.000Z" },
  "weekly": { "usedPercent": 67, "remainingPercent": 33, "resetAt": "2026-10-30T02:30:21.000Z" },
  "updatedAt": "2026-10-24T10:34:25.655Z"
}
```

MiniMax 型：

```json
{
  "ok": true,
  "provider": "minimax-cn",
  "kind": "minimax",
  "model": "MiniMax-M2.5",
  "fiveHour": { "usedPercent": 17, "remainingPercent": 83, "resetAt": "2025-10-09T13:53:20.000Z" },
  "weekly": { "usedPercent": 20, "remainingPercent": 80, "resetAt": "2025-10-16T08:53:20.000Z" },
  "updatedAt": "2026-10-25T04:34:09.837Z"
}
```

Xiaomi MiMo 型：

```json
{
  "ok": true,
  "provider": "xiaomi",
  "kind": "xiaomi-mimo",
  "currency": "CNY",
  "amount": "65.27",
  "cashBalance": "60.00",
  "giftBalance": "5.27",
  "plan": {
    "used": 25000000,
    "limit": 100000000,
    "usedPercent": 25,
    "remainingPercent": 75,
    "resetAt": "2026-11-01T00:00:00.000Z",
    "name": "Lite",
    "month": { "usedPercent": 5, "remainingPercent": 95 }
  },
  "updatedAt": "2026-10-25T04:34:09.837Z"
}
```

失败：

```json
{ "ok": false, "provider": "zai-coding-cn", "kind": "glm", "reason": "missing-credential" }
```

`reason` 取值：

| reason | 含义 |
| --- | --- |
| `unsupported` | provider 不在映射中；客户端隐藏条目 |
| `missing-credential` | 找不到任何候选凭证名 |
| `missing-cookie` | Xiaomi MiMo 控制台 Cookie 未配置 |
| `signed-out` | DeepSeek 账号未登录 |
| `unavailable` | 当前 profile 没有对应服务 |
| `error` | 网络、HTTP、响应解析或业务错误；`error` 字段带截断后的原因 |

### 缓存

缓存键是 `provider + kind + endpoint + keyNames` 的配置指纹，不包含凭证值；值是 `{ at, value }`。默认 TTL 30 秒，可由 `config.cacheSeconds` 覆盖。

- 只缓存 `ok: true` 的结果；`missing-credential`、`signed-out` 等终态不缓存，并删除同键旧成功值。
- 同指纹请求共享 pending Promise，settle（包括 5 秒超时失败）后清理 pending。
- 成功缓存最多 50 条，读取和写入都会刷新 LRU 顺序。
- 网络、超时、HTTP、响应解析、凭证服务和 DSH 账号 `status: failed` 都属于临时失败；旧成功值只在这种情况下以 `stale` 返回。
- 修改 `apiKeyEnv` 或 `baseURL` 会改变指纹，因此不会命中修改前的缓存。

## Client 侧

### 模块加载

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-llm-quota',
  factory(require) { ... return { inject: ['slots', 'locale'], apply(ctx) { ... } } },
})
```

- `id` 必须等于包名。
- `React` 与 `react-dom` 来自浏览器模块表，不需要打包 React。
- `inject` 只用于激活顺序；`slots` 提供 slot 注册，`locale` 提供字典注册。

### Slot 注册

```js
ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
  name: 'conversation.composer.dock',
  id: 'llm-quota',
  order: 2,
  locale: NS,
}, QuotaPill))
```

`ctx.slots.inject` 的回调在该 slot 的 owner 声明存在时执行；owner 撤销时注册自动回收。

### 当前 provider

组件从 slot 标准 props 拿到 `useProjection`：

```js
const selection = useProjection('modelSelection')
const provider = selection?.next?.provider ?? selection?.lastUsed?.provider ?? ''
```

- `next` 是下一次请求将使用的选择，用户切换模型后立即变化。
- `lastUsed` 是最近一次已消费的请求选择。
- 没有选择时传空，Host 回退到默认模型。

### 刷新

- 首次挂载立即请求一次。
- 每 60 秒轮询一次；切换 provider 时重置、abort 旧请求并立即重新请求，组件卸载时也会 abort。
- 同一 Client effect 同时最多执行一个请求；Host 再按配置指纹做单飞。
- 请求超时 8 秒（Host 单次读取最长 5 秒）；网络失败、超时或 Host 返回临时 `error` 时只保留之前的成功数据并标记 `stale`。
- 终态响应直接替换旧数据；没有使用 SSE，避免为低频数据维护长连接。

### 浮层

点击条目后用 `ReactDOM.createPortal` 挂到 `document.body`，位置由触发按钮的 `getBoundingClientRect()` 计算，向上展开。放在 portal 里是因为 composer 位于可滚动容器内，普通绝对定位会被裁剪。

- 点击外部、按 Escape、窗口 resize 时关闭。
- 样式只使用 `--dsw-alias-*`、`--dsw-specific-*` 和 `--dsh-*` 主题变量，不写死颜色。
- 条目本身是 `button`，带 `aria-haspopup="dialog"` 与 `aria-expanded`。

### 模型选择处的额度

模型选择菜单的分组标题和输入区的当前模型标签由 ui-model-selection 渲染，它们不属于 composer dock，也没有可用的 list slot。`conversation.input.model.label` 虽然是官方的模型名替换入口，但它是 `single` slot，已被内置 `ui-deepseek-model-label-1017`（模型行里的 `1017` 徽标）以优先级 0 占用；同优先级注册会抛错，用 `priority: -1` 抢占会覆盖掉该徽标。

本插件因此采用纯 CSS 装饰，复用 ui-model-selection 已公开的 DOM 钩子：

| 位置 | 选择器 |
| --- | --- |
| 当前模型（composer 触发器） | `button[aria-haspopup="menu"] > span > span[data-provider-id=...]::before` |
| provider 分组标题（菜单内） | `section[data-menu-group]:has(span[data-provider-id=...]) > [data-menu-group-heading]::after` |

- 胶囊样式只使用 `--dsw-alias-*` 变量，与内置 Tag neutral 外观一致。
- 依据 provider 生成一条 `content` 规则，写入 `#llm-quota-model-badges` 样式表；数据变化时整表重写。
- 仅 `ok: true` 的结果生成规则；异常态（未配置凭证、未登录、接口失败）不显示任何内容。
- `/model` 斜杠命令弹窗的选项只有 label 字符串，DOM 中没有 provider 标识，因此不在覆盖范围内。

#### 数据源与刷新

- `MutationObserver` 只观察新增节点，并且仅当节点自身匹配或包含 `span[data-provider-id]`、`[data-menu-group]` 时才触发扫描，避免聊天流式输出造成无谓扫描；扫描延迟 250ms 合并。
- 每个 provider 一条记录：成功结果复用 60 秒；临时失败 30 秒后重试；失败与请求中都不会重复发起（Host 再做 30 秒缓存与单飞）。
- 扫描会顺带读取触发器的 provider，因此新会话欢迎页（没有 dock）也能显示当前模型额度。
- locale 切换时重算文案；DSH 升级后若 DOM 钩子改名，装饰会静默失效，不影响模型选择。

### 本地化

`client.js` 内置 `zh`/`en` 两份字典，通过 `ctx.locale.register(NS, DICT)` 注册；slot 注册时传 `locale: NS`，框架会注入绑定后的 `t`。`locale/*.json` 只负责插件管理页的标题和描述。

## 本地开发与验证

```bash
# 语法与 Host 回归测试
npm run check
npm test

# 组合配置中是否有插件行
dsh --profile web --dump-config | grep -A 3 llm-quota

# 启动
dsh web --port 3090 --no-open

# 未认证请求应返回 401；真实额度通过认证浏览器会话验证
curl -i 'http://127.0.0.1:3090/api/llm-quota?provider=zai-coding-cn'
```

浏览器验证要点：

1. 打开一个已有会话（欢迎页没有 composer dock）。
2. 状态行应出现额度条目，且不影响原有条目。
3. 点击条目应弹出浮层，Escape 可关闭。
4. 切换模型后条目内容应随 provider 变化。
5. 控制台不应出现 `slot entry crashed in 'conversation.composer.dock'`。

### 改动后的加载行为

- Host 侧 `index.js` 改动：由 HMR/loader 重新加载；如果 profile 没有 HMR，重启 dsh。
- Client 侧 `client.js` 改动：客户端模块 revision 来自文件 mtime/size；刷新页面获取新模块。刷新后仍加载旧内容时，重启 dsh 再刷新。
- 修改 `package.json` 的 `dsh` 或 `exports` 后，需要重启 Host。

## 约束

- Host 路由由 DSH Connection 统一执行 Host/Origin 检查和登录认证；非回环部署也不能绕过该边界。
- 自动解析只处理 DSH 激活 provider 和已知 HTTPS 主机；`config.providers` 是受信任的显式例外，未知输入不会进入缓存或触发上游请求。
- 状态行只在 `variant === 'composer'` 且有 session 时渲染；这是 ui-conversation 的既有行为。
- 供应商接口若变更字段，只需要改 `providers/` 下对应的适配器，客户端响应结构保持不变。
- Loader 实时配置读取和 manifest 兼容版本当前针对 DSH `0.2.1-rc.2`。
