# 架构与实现

本文面向维护者，说明 dsh-llm-quota 的 Host / Client 两半如何协作，以及改动时需要注意的边界。安装与使用见根目录 [README](../README.md)，各供应商的上游接口见 [providers.md](providers.md)。

## 目录

- [总览](#总览)
- [文件职责](#文件职责)
- [渲染位置](#渲染位置)
- [Host 侧](#host-侧)
  - [激活与依赖](#激活与依赖)
  - [请求生命周期](#请求生命周期)
  - [缓存与并发](#缓存与并发)
  - [超时与降级](#超时与降级)
  - [Provider 展示清单与 ViewModel](#provider-展示清单与-viewmodel)
  - [响应形状](#响应形状)
  - [失败原因](#失败原因)
- [Client 侧](#client-侧)
  - [模块加载](#模块加载)
  - [Slot 注册](#slot-注册)
  - [当前 provider](#当前-provider)
  - [轮询与刷新](#轮询与刷新)
  - [展开浮层](#展开浮层)
  - [模型菜单与当前模型标签](#模型菜单与当前模型标签)
  - [本地化](#本地化)
  - [配置页面](#配置页面)
- [本地开发与验证](#本地开发与验证)
- [约束](#约束)

## 总览

```text
内置 Provider + providerModules（受信任的 Host ESM）
    ▼
createProviderRegistry()
    ├─ kind / HTTPS hostname 索引
    └─ 聚合 views / messages / credentials / history manifest
                                      │
浏览器启动                            │ GET /api/llm-quota/views
  ├─ 注册通用 locale                  ▼
  └─ 创建通用视图引擎 ◀──── 展示元数据、Provider 文案与历史指标
    │
    │  QuotaPill → useProjection('modelSelection') → provider
    │  GET /api/llm-quota?provider=...
    ▼
DSH Connection（Host/Origin 检查 + 登录认证）
    ▼
dsh Host
  显式 override → matchProvider() → DSH 激活目录与实时 profile
    → 按注册顺序执行 Provider route() → HTTPS hostname 映射
    → 受限 read()（凭证、HTTP、声明的 services、AbortSignal）
    → 归一化 ok / provider / kind / updatedAt
    → Provider present() 生成纯数据 ViewModel
    → 返回 { ...额度数据, viewId, view }
    │
    └─ 配置指纹 + 30 秒成功缓存 + 单飞 + 50 条 LRU
```

每个 Provider 在自己的模块中维护 `hosts`、`route()`、`read()`、`view` 和可选 `present()`；具体上游接口见 [providers.md](providers.md)。Client 只识别 `balance`、`credits`、`usage`、`plan` 四种通用版式，不加载或执行第三方 Provider 的浏览器代码。密钥只经过 Host；manifest 和额度响应不包含凭证明文、`cacheKey` 或路由秘密。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `package.json` | bundle 清单；`dsh.bundle.patch` 指向补丁；`dsh.client` 声明 Web 客户端、激活顺序和依赖 |
| `cordis.patch.yml` | 插入 `id: llm-quota` 的 Host 插件行 |
| `index.js` | Host 插件入口：注册额度 / 历史 / i18n / views Connection 认证路由、共享缓存 / 单飞、后台采集生命周期、错误归一化；供应商细节委托给 `providers/` |
| `history.js` | 历史指标提取、变化去重、30 天 / 20,000 点清理、SQLite WAL 持久化，以及全 provider 单轮采集与定时器控制 |
| `provider.js` | Provider 公共 API 再导出（`defineProvider` 与共享工具），供第三方模块 `@cs-qyzhang/dsh-llm-quota/provider` 导入 |
| `providers/runtime.js` | `defineProvider` 包装与结果归一化：注入凭证 / HTTP / 服务与时间，统一 `ok` / `provider` / `kind` / `updatedAt` |
| `providers/registry.js` | Provider 注册表：内置 + `providerModules` 动态加载、`kind` / 主机索引、views / 凭据 / 历史指标 / 自带文案清单 |
| `providers/resolve.js` | 读取 DSH 实时 provider 配置，把 provider id 解析成额度路由（覆盖 → `matchProvider` → 各 Provider `route()` → 主机映射） |
| `providers/presentation.js` / `presets.js` / `view-helpers.js` | Provider 展示层：结构化文案引用、内置版式与共享 `present` 帮助函数 |
| `providers/core.js` / `shared.js` | 适配器共享工具：凭证读取、上游 HTTP、缓存指纹、统一响应片段 |
| `providers/<kind>.js` | 单个额度体系的 Provider（`kind`、`hosts`、`route`、`read`、`view`、`present`） |
| `client.js` | Client 插件：拉取并注册 locale 字典与 Provider views、向 composer dock 注册条目、模型选择标签 / 分组标题的额度装饰、轮询、渲染浮层；内含 manifest 驱动的视图引擎（版式回退、Provider 自带翻译、错误与行渲染、历史指标选择）；不含任何供应商专属代码。浏览器侧产物必须是单文件经典脚本（`<script src>` 直接注入，无 ES module 解析），因此视图引擎内联在本文件中 |
| `locale/*.json` | 通用文案来源：`meta`（插件管理页标题 / 描述）与 `messages`（界面文案字典），供 Host i18n 路由读取；Provider 专属文案另可声明在 `view.messages` |
| `icon.svg` | 插件图标 |
| `test/host.test.js` / `provider.test.js` | Host 路由、缓存、配置与 Provider 注册 / 归一化 / manifest 回归测试 |
| `test/client.test.js` | 通用视图引擎、manifest 回退、设置与历史交互测试 |
| `test/history.test.js` | SQLite 持久化、指标提取、采集、清理和抽样测试 |
| `test/<kind>.test.js` | 各供应商适配器的 mock HTTP 与解析测试，不访问真实供应商 |
| `test/locale.test.js` | 通用文案键 / 占位符对齐、无死键、代码无中文文案 |

## 渲染位置

`conversation.composer.dock` 是 ui-conversation 声明的 `list` 类型 slot，作用域为 `session`。它被渲染在输入卡片正下方的 `.dock` 行里，后面紧跟 ContextMeter。

现有条目：

| 条目 | 注册方 | order |
| --- | --- | --- |
| 轮次 / 步数 / 速度 | ui-chat | 0 |
| token 用量 / 缓存命中 | ui-chat | 1 |
| 模型额度 | 本插件 | 2 |

因此额度条目出现在「缓存命中」和上下文百分比之间。不要尝试用绝对定位去贴状态行；选择已有 slot 是唯一稳定的位置来源。

## Host 侧

### 激活与依赖

```js
export const inject = ['connection', 'credentials', 'llm', 'loader']
export function apply(ctx, config) { ... }
```

- `connection` 提供 `ctx.connection.fetch.register()`，注册四个 GET 认证路由：额度 `/api/llm-quota`、历史 `/history`、通用文案 `/i18n` 和 Provider 展示清单 `/views`。历史路由仅在 `history` 开启时注册。
- `llm` 提供激活 provider 列表和 configurable-provider directory；`loader` 提供对应插件 entry 的实时配置，优先读取 `fiber.effectiveConfig`，回退 `fiber.config`。
- `credentials` 提供 `ctx.credentials.resolve(name)`，按实时引用名读取密钥。
- Provider 必须显式声明 `services` 才能在 `read()` 中取得对应服务；DeepSeek Account 通过此机制惰性获取 `deepseekAccount`，缺少该服务时只让对应 provider 返回 `unavailable`。
- registry 先同步注册内置 Provider，再异步加载 `providerModules`。模块加载失败保存在 `readyError`：`/views` 返回结构化 `error`，内置 Provider 的额度路由仍可工作，但 Client 无法取得正常 manifest 并使用形状回退展示。

### 请求生命周期

1. 读取 `provider` 查询参数；为空时回退到 `ctx.get('agentDefaultModel').currentSelection().provider`，再回退到 `deepseek-account`。
2. `config.providers` 精确覆盖优先，可由 Provider 的 `normalizeOverride()` 补充默认值，不要求 DSH 中存在同名激活路由；然后遍历 `matchProvider()` 处理 `deepseek-account` 等直接匹配。
3. 其他 provider 必须已在 DSH 激活，并能通过 `listConfigurableProviders()` 和 Loader 找到实时配置。通用上下文包含 `profile.apiKeyEnv ?? directory.nativeAuth.env`、`profile.baseURL ?? directory.defaultBaseURL` 与 OAuth 标志。
4. 按注册顺序执行各 Provider 的可异步 `route()`；未命中时才使用已知 HTTPS hostname 映射。定义了 `route()` 的 Provider 默认设置 `allowSpecialBeforeOAuth: true`，可在 OAuth-only 路由中使用自己的专用凭证；普通主机映射和未命中的未知路由仍不绕过 OAuth 门禁。
5. 用 `provider + kind + endpoint + mode + keyNames` 生成不含秘密的配置指纹，命中 30 秒成功缓存则直接返回。
6. 未命中时共享同指纹的 pending Promise；成功后写入最多 50 条的 LRU，终态失败不写缓存并删除同键旧值。
7. 临时异常不写缓存；如果有旧成功值，返回旧值并加 `stale: true`，否则返回 `ok: false` 和失败原因。
8. 每次 `readQuota`（含凭证解析、DSH 账号服务与上游 HTTP）有 5 秒总超时；Host 将 `AbortSignal` 传入 Provider 和共享 HTTP，超时按临时失败处理。
9. 包装层统一归一化 `ok/provider/kind/updatedAt`，再附加 `viewId` 和 Host `present()` 生成的纯数据 `view`。

provider id 到额度路由的完整规则见 [providers.md](providers.md#自动解析)。

### 缓存与并发

缓存键是 `provider + kind + endpoint + mode + keyNames` 的配置指纹，不包含凭证值；值是 `{ at, value }`。默认 TTL 30 秒，可由 `config.cacheSeconds` 覆盖。

- 只缓存 `ok: true` 的结果；`missing-credential`、`signed-out` 等终态不缓存，并删除同键旧成功值。
- 同指纹请求共享 pending Promise，settle（包括 5 秒超时失败）后清理 pending。
- 成功缓存最多 50 条，读取和写入都会刷新 LRU 顺序。
- 修改 `apiKeyEnv`、`baseURL` 或凭证引用名会改变指纹，因此不会命中修改前的缓存。
- 缓存头为 `Cache-Control: no-store`，浏览器与中间层不缓存额度响应。

### 历史采集与持久化

`history` 配置默认为 `true`。Host 激活后立即执行一轮采集，之后默认每 30 秒触发一轮，可通过 `historyIntervalSeconds` 按秒调整（最小 1 秒），不依赖浏览器页面或会话是否打开；设为 `history: false` 时不注册历史路由、不启动定时器，也不写历史。

- 每轮动态合并激活 provider、`config.providers` 和可用的 `deepseek-account`，经 `resolveRoute()` 过滤 unsupported / unavailable 路由。
- 单轮最多 3 个 provider 并发，失败相互隔离；上一轮未完成时下一轮不重入。后台读取绕过 TTL，但与普通请求共享 pending 单飞和成功缓存。
- 只有新鲜且 `ok: true` 的结果进入历史。缓存命中、stale、未登录、缺失凭证和网络错误均不写点。
- 历史以 `route.cacheKey` 分区。首点总是保存，后续仅当 `kind / mode / currency / metrics` 变化时追加；`updatedAt`、`stale` 和 `resetAt` 不参与签名，避免相对重置时间产生伪变化。
- 指标由当前 route 对应 Provider 的 `view.history` 声明，通过 `{ key, path, unit, label }` 提取；四种 preset 分别提供默认指标，Provider 自己的 `history` 数组会替换而非追加 preset 声明。没有可解析 history spec 或没有可提取数值时不写点，不再由 Host 固定遍历品牌白名单。金额保存原始字符串，绘图时才转数值。
- 默认文件为 `$DSH_HOME/data/llm-quota-history.sqlite`，未设置 `DSH_HOME` 时使用 `~/.dsh/data/llm-quota-history.sqlite`。使用 Node `>=22.13.0` 内置 `node:sqlite` 和 WAL，无需第三方依赖。
- `history_points` 按 `(provider_key, recorded_at, id)` 建索引，每个变化点在事务中增量 `INSERT`，不再复写全量历史；同一事务删除过期点并裁剪当前配置指纹的点数。区间查询分别读取最后一个基线点和后续变化点，存储异常不影响额度查询。
- 每次写入清理 30 天前的数据，并将每个配置指纹限制为 20,000 点。重载后最后一点仍参与去重。

历史路由为 `GET /api/llm-quota/history?provider=<id>&days=1|7|30`，也支持用 `hours=1|4|12` 替换 `days`；未提供范围参数时使用 `historyDefaultRange`（默认 `1h`），两个范围参数不能同时提供。它只解析当前 route 并读取本地文件，不访问上游，返回 `{ ok, provider, since, points, sampled, historyDefaultRange }`；结果额外包含区间前最后一个点作为基线。为限制传输与 SVG 渲染成本，Host 在查询后把响应抽样到最多 100 点，保留首末点和各指标极值，抽样时 `sampled: true`；这只影响响应，不删除 SQLite 原始点。认证、Host/Origin 检查和 `no-store` 行为与额度路由一致。

### 超时与降级

| 层级 | 超时 | 失败行为 |
| --- | --- | --- |
| Host 单次额度读取 | 5 秒（含凭证解析与上游 HTTP） | 有旧成功值则返回 `stale: true`，否则 `reason: 'error'` |
| Client 单次请求 | 8 秒 | 保留已有数据并标记过期 |
| Client 轮询 | 60 秒 | 下一次轮询重试 |
| Client 失败重试 | 30 秒 | 失败后不立即重复发起 |

### Provider 展示清单与 ViewModel

`GET /api/llm-quota/views` 在 registry ready 后返回：

```json
{
  "ok": true,
  "views": { "kimi": { "preset": "plan", "title": "Kimi" } },
  "messages": { "en": {}, "zh": {} },
  "credentials": [],
  "history": { "fiveHour": { "unit": "percent", "label": { "key": "metricFiveHour" } } },
  "historyPriority": ["fiveHour", "weekly"]
}
```

- `views` 以 Provider 注册 `kind` 为键，由 preset 与 Provider `view` 浅合并而成；`credentials` 与 `messages` 被剥离并分别全局聚合。凭证按 `id`、历史元数据按指标 `key` 首次出现去重，`historyPriority` 保持注册顺序。
- 每次额度读取还会附加 `viewId: <注册 kind>` 和 `view`。响应数据的 `kind` 可被适配器覆盖为 `balance` 等兼容形状，不能替代 `viewId` 选择 Provider 展示。
- `present()` 只在 Host 执行，可返回 `title / compact / badge / rows / gauge / errors` 等纯数据覆盖；文案使用 `{ key, params }` 引用。失败响应会移除成功态标题、行和 gauge。浏览器不接收函数、React 组件或 Cordis ctx。
- Client 的解析顺序是 `viewId ?? kind` 查 manifest、合并非空响应 `view`，没有 manifest 时按响应形状推断 balance / usage / plan。`/views` 获取失败时每 30 秒重试，配置保存不会主动刷新已打开 Client 的 manifest。

### 响应形状

以下示例省略其余额度字段和重复 ViewModel；所有已解析 Provider 的成功或失败读取都会附加 `viewId` 与可序列化 `view`。

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
  "updatedAt": "2026-10-24T10:34:09.837Z",
  "viewId": "account",
  "view": { "preset": "balance", "title": { "key": "balanceTitle" } }
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

Moonshot 余额型：

```json
{
  "ok": true,
  "provider": "moonshotai-cn",
  "kind": "balance",
  "service": "moonshot",
  "currency": "CNY",
  "amount": "49.58894",
  "wallets": [{ "currency": "CNY", "balance": "3.00001" }],
  "bonusWallets": [{ "currency": "CNY", "balance": "46.58893" }],
  "available": true,
  "updatedAt": "2026-10-25T04:34:09.837Z"
}
```

OpenRouter / Vercel AI Gateway 余额型：

```json
{
  "ok": true,
  "provider": "openrouter",
  "kind": "openrouter",
  "currency": "USD",
  "amount": "15.5",
  "totalCredits": "20",
  "totalUsage": "4.5",
  "updatedAt": "2026-10-25T04:34:09.837Z"
}
```

```json
{
  "ok": true,
  "provider": "vercel",
  "kind": "vercel-gateway",
  "currency": "USD",
  "amount": "95.50",
  "totalUsage": "4.50",
  "updatedAt": "2026-10-25T04:34:09.837Z"
}
```

Qwen Token Plan 型：

```json
{
  "ok": true,
  "provider": "qwen-token-plan-cn",
  "kind": "qwen",
  "plan": {
    "usedPercent": 50,
    "remainingPercent": 50,
    "resetAt": "2026-08-13T00:00:00.000Z"
  },
  "updatedAt": "2026-10-25T04:34:09.837Z"
}
```

Xiaomi MiMo 型（按量计费）：

```json
{
  "ok": true,
  "provider": "xiaomi",
  "kind": "xiaomi-mimo",
  "mode": "balance",
  "currency": "CNY",
  "amount": "65.27",
  "cashBalance": "60.00",
  "giftBalance": "5.27",
  "updatedAt": "2026-10-25T04:34:09.837Z"
}
```

Xiaomi MiMo 型（Token Plan）：

```json
{
  "ok": true,
  "provider": "xiaomi-token-plan-cn",
  "kind": "xiaomi-mimo",
  "mode": "plan",
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

`mode` 由 provider 的推理主机决定：`api.xiaomimimo.com` 为 `balance`，`token-plan-*.xiaomimimo.com` 为 `plan`；显式 `config.providers` 覆盖按 provider id 推断。未声明 `mode` 的自定义覆盖仍兼容旧行为，同时返回余额与套餐。

失败：

```json
{
  "ok": false,
  "provider": "zai-coding-cn",
  "kind": "glm",
  "reason": "missing-credential",
  "viewId": "glm",
  "view": { "preset": "plan" }
}
```

### 失败原因

| reason | 含义 |
| --- | --- |
| `unsupported` | provider 不在映射中；客户端隐藏条目 |
| `missing-credential` | 找不到适配器需要的候选凭证 |
| `missing-management-key` | xAI Management Key 未配置 |
| `missing-cookie` | Xiaomi MiMo 控制台 Cookie 未配置 |
| `missing-console-token` | Qwen Token Plan 控制台 access token 未配置 |
| `signed-out` | DeepSeek 账号未登录 |
| `unavailable` | 当前 profile 没有对应服务 |
| `error` | 网络、HTTP、响应解析、业务或 Provider 模块加载错误；`error` 字段带截断后的原因 |
| `invalid-range` | 历史查询同时传了 `days` 与 `hours`，或范围不在允许枚举中 |
| `history-unavailable` | 本地历史读取失败 |

所有路由均以 JSON 和 `Cache-Control: no-store` 返回；业务失败通过 `ok: false` 表达，而不是改用其他 HTTP 状态码。`GET /api/llm-quota/i18n` 返回 `{ ok, dictionaries }`，字典来自 `locale/*.json` 的 `messages`。

## Client 侧

### 模块加载

```js
window.__ModuleLoader__.load({
  id: '@cs-qyzhang/dsh-llm-quota',
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

### 轮询与刷新

- 首次挂载立即请求一次。
- 每 60 秒轮询一次；切换 provider 时重置、abort 旧请求并立即重新请求，组件卸载时也会 abort。
- 同一 Client effect 同时最多执行一个请求；Host 再按配置指纹做单飞。
- 请求超时 8 秒（Host 单次读取最长 5 秒）；网络失败、超时或 Host 返回临时 `error` 时只保留之前的成功数据并标记 `stale`。
- 终态响应直接替换旧数据；没有使用 SSE，避免为低频数据维护长连接。

### 展开浮层

点击条目后用 `ReactDOM.createPortal` 挂到 `document.body`，位置由触发按钮的 `getBoundingClientRect()` 计算，向上展开。放在 portal 里是因为 composer 位于可滚动容器内，普通绝对定位会被裁剪。

- 点击外部、按 `Escape`、窗口 resize 时关闭。
- 样式只使用 `--dsw-alias-*`、`--dsw-specific-*` 和 `--dsh-*` 主题变量，不写死颜色。
- 条目本身是 `button`，带 `aria-haspopup="dialog"` 与 `aria-expanded`。

浮层中的历史区块由独立 `QuotaHistory` 组件负责，仅打开时请求历史路由，并每 20 秒重读本地历史；关闭、切换 provider 或卸载会 abort。额度条目本身仍按 60 秒刷新，不新增 UI 侧上游采样。

- 支持近 1、4、12、24 小时、7 天、30 天和多指标切换。指标标签与默认曲线顺序来自 manifest 的 `history` 和 `historyPriority`，不再使用 Client 固定的品牌白名单。
- 初始范围由 `historyDefaultRange` 决定，默认近 1 小时。新挂载时通过无范围历史请求读取生效配置；若用户尚未手动选择且配置不是 1 小时，再按配置范围查询。配置只决定初始范围，20 秒刷新不覆盖手动选择；保存后重新打开浮层或切换 provider 时使用新默认值。
- SVG 通过非被动 wheel 监听逐级缩放：向上滚动缩短窗口、向下滚动放大窗口，220ms 节流，在 1 小时和 30 天边界停止，并阻止图表滚轮事件带动页面或浮层滚动。
- 图表使用内联 SVG 阶梯线：区间前基线延伸到区间起点，最后一个实际值延伸到当前时间，展示用末点不会写回存储。
- 百分比纵轴固定 0–100，金额轴按极值留白；摘要显示区间首值、最新值和变化量，数据点 `<title>` 提供精确时间与原始金额。
- 加载、空历史、无指标和失败均有本地化状态，图表只使用 DSH 主题 token，不增加第三方图表依赖。

### 模型菜单与当前模型标签

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

通用界面文案来自 `locale/*.json`。除中文、英文外，还覆盖 dsh 支持的全部语言：`ja`、`es`、`fr`、`de`、`ru`、`pt`（与 `@deepseek-ai/dsh-client-locale` 的语言 id 一致）。每个文件包含两节：`meta` 提供插件管理页的标题与描述，`messages` 是界面文案字典（`{key}` 占位符模板）。Provider 专属文案可以另写在 `view.messages`，通过 `/views` 随 manifest 下发；视图引擎依次查当前语言的 Provider 文案、Provider 英文文案和全局 `t()`。

- Host 在 `GET /api/llm-quota/i18n` 路由上按语言返回 `messages`；读取时按文件名识别语言 id，只接受 `messages` 为对象的文件。
- Client 启动时拉取字典并调用 `ctx.locale.register(NS, dictionaries)` 注册；注册可晚于界面挂载，locale service 会推进 revision，slot 文案无需重挂载即可更新。拉取失败按 30 秒间隔重试，直到字典落地。
- slot 注册时传 `locale: NS`，框架注入绑定后的 `t`；字典未到达前由 `fallbackTranslate` 兜底（以 `en` 为准做占位符替换）。

新增通用文案键需要同步全部 locale 文件；Provider messages 至少应提供 `en`，其他语言按需补充，并避免与其他 Provider 的全局 key 冲突。`test/locale.test.js` 固化了以下约定：dsh 支持的每种语言都有字典、各语言键集合与 `en` 一致、每键占位符一致、无死键、`tr()` 调用与动态键（错误键、通知键、范围标签等）都能解析到字典键，且 `client.js` 中不残留中文文案。

### 配置页面

`client.js` 向 Plugins 页的 `plugins.bundle.config` keyed slot 注册配置页，key 为包名 `@cs-qyzhang/dsh-llm-quota`。页面出现在该 bundle 详情页的描述与行列表之间，分为「运行配置」和「供应商额外凭证」两区。

运行配置完整覆盖 Host 的六个配置项：

| 配置项 | 默认值 | UI 与约束 |
| --- | --- | --- |
| `cacheSeconds` | `30` | 成功缓存秒数，允许 0；留空恢复继承值 |
| `history` | `true` | 历史采集开关；关闭后禁用间隔输入但保留草稿 |
| `historyDefaultRange` | `1h` | 历史浮层初始范围下拉框；可选 `1h`、`4h`、`12h`、`1d`、`7d`、`30d`，保存后重新打开浮层生效 |
| `historyIntervalSeconds` | `30` | 采集间隔秒数，最小 1；留空恢复继承值 |
| `providers` | `{}` | JSON 编辑器；根及每个 provider 值必须是对象，所有适配器字段原样保存 |
| `providerModules` | `[]` | JSON 编辑器；npm 模块名、绝对路径或相对 Host 工作目录的路径数组；支持 `default` / `provider` / `providers` 导出 |

- Host 导出对应的 volatile Schemastery `Config`，并调用 `settings.configure({ auto: false })` 关闭重复的系统表单。`apply` 同时兼容 volatile `.get()` ref 与普通配置值。
- 页面通过 `remote.settings.describe()` 读取 `llm-quota` 命名空间及 `revision`，通过 `remote.settings.mutate()` 仅提交变化的顶层路径；并发冲突会重新读取而不覆盖新值，配置层只读时禁用保存。
- 保存触发 `loader/volatile-update` 后重启当前 fiber，既有 effect 会注销旧路由、停止采集器并关闭 SQLite，再以新配置重建缓存和后台任务。Client 的 `/views` 与 `/i18n` 仅在自身 effect 启动时获取，失败才每 30 秒重试；新增 Provider 或其静态展示、文案、凭证声明变化后，应刷新页面。
- 页面通过可选的 `ctx.inject(['slots', 'remote', 'remote.credentials', 'remote.settings'], ...)` 注册；缺少所需 Remote 或 Plugins 页时页面不出现，composer dock 的额度条目不受影响。

供应商额外凭证由 Provider 的 `view.credentials` 声明，manifest 按 `id` 去重后动态生成。当前内置配置行包括：

| 字段 | 凭据引用 |
| --- | --- |
| Xiaomi MiMo 控制台 Cookie | `MIMO_COOKIE` / `XIAOMI_MIMO_COOKIE` |
| Qwen 控制台 Access Token | `QWEN_CONSOLE_TOKEN` / `BAILIAN_CONSOLE_TOKEN` |
| xAI Management Key | `XAI_MANAGEMENT_KEY` / `XAI_MANAGEMENT_API_KEY` |
| Anthropic / OpenAI Admin Key | 两家各自的 Admin Key 引用，共用 `admin-key` 配置行 |
| GitHub Token | `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_COPILOT_TOKEN` |
| Codex OAuth Token | `OPENAI_CODEX_TOKEN` / `OPENAI_CODEX_OAUTH_TOKEN` / `CHATGPT_OAUTH_TOKEN` |
| Codex Account ID | `OPENAI_CODEX_ACCOUNT_ID` / `CHATGPT_ACCOUNT_ID` |
| Cloudflare API Token | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_API_KEY` |
| Cloudflare Account ID | `CLOUDFLARE_ACCOUNT_ID` |

- 状态读取使用 `remote.credentials.describe(refs)`，只返回 `configured` / `source` / `writable`；保存与清除分别调用 `remote.credentials.set(ref, value)` 和 `remote.credentials.unset(ref)`，明文不会回传浏览器。
- 主引用未配置但兼容别名已配置时，页面显示「已配置（别名）」；由环境变量或更高配置层提供的凭据 `writable: false`，页面显示只读。
- 单独保存凭证后 Host 的 30 秒成功缓存不会被主动清除，因此下一次额度刷新（客户端最长 60 秒）才会读到新凭证。

## 本地开发与验证

```bash
# 语法检查与自动化回归测试（不访问真实供应商）
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
3. 点击条目应弹出浮层，`Escape` 可关闭。
4. 切换模型后条目内容应随 provider 变化。
5. Plugins → Installed plugins → 模型额度 的详情页应出现「运行配置」与「供应商额外凭证」。六项配置应显示当前值，非法数值 / JSON / 时间范围不得发起写入；保存后刷新页面仍保持，并立即重建 Host 路由与采集器。默认历史范围为近 1 小时；改为近 30 天保存后，重新打开浮层应默认选中该范围，手动选择不受 20 秒刷新影响。
6. 供应商凭证保存 / 清除后状态应即时变化，别名与只读状态保持原有行为。
7. 控制台不应出现 `slot entry crashed in 'conversation.composer.dock'`。

### 改动后的加载行为

- Host 侧 `index.js` 改动：由 HMR / loader 重新加载；如果 profile 没有 HMR，重启 dsh。
- Client 侧 `client.js` 改动：客户端模块 revision 来自文件 mtime/size；刷新页面获取新模块。刷新后仍加载旧内容时，重启 dsh 再刷新。
- 修改 `package.json` 的 `dsh` 或 `exports` 后，需要重启 Host。

## 约束

- Host 路由由 DSH Connection 统一执行 Host/Origin 检查和登录认证；非回环部署也不能绕过该边界。
- 自动解析只处理 DSH 激活 provider 和已知 HTTPS 主机；`config.providers` 是受信任的显式例外，未知输入不会进入缓存或触发上游请求。
- 状态行只在 `variant === 'composer'` 且有 session 时渲染；这是 ui-conversation 的既有行为。
- 供应商接口或展示字段变更通常只需修改对应 Provider 的 `read/view/present`；只有新增通用版式、公共响应字段或 Client 交互时才需要修改通用核心。
- `package.json` 声明支持 Node `>=22.13.0` 和 DSH `>=0.2.1-rc.2 <0.2.2 || >=0.2.2-0 <0.2.3`。Loader 同时兼容 `fiber.effectiveConfig` 与旧 `fiber.config`；这是包声明范围，不代表每个版本均已完成真实浏览器验证，升级后仍需重新核对配置结构并执行 smoke。
