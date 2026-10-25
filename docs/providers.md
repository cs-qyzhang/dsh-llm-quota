# 供应商适配

本插件按「当前会话所选模型的 provider id」选择额度适配器。provider id 是 DSH 模型路由的名字，例如 profile 中 `llm-pi-ai.providers` 的键。插件不再根据名称猜测供应商，而是读取 DSH 当前激活路由的实时配置。

## 自动解析

每次请求按以下顺序解析：

1. `config.providers` 中的精确显式覆盖优先。
2. `deepseek-account` 使用 Host 账号服务。
3. 其他 provider 必须已在 `ctx.llm.listProviders()` 中激活，并能通过 `listConfigurableProviders()` 和 Loader 找到实时配置。
4. pi-ai 的显式 `profile.apiKeyEnv` 优先，缺省使用目录中的 `nativeAuth.env`；`profile.baseURL` 优先，缺省使用 `defaultBaseURL`。
5. DeepSeek API Key 使用自身实时 `apiKeyEnv`；`baseURL` 依次取实时 config、`DEEPSEEK_BASE_URL`、公开默认值。
6. 仅把下列已知 HTTPS 主机映射到固定额度端点：

| 实时推理主机 | 适配器 `kind` | 固定额度端点 |
| --- | --- | --- |
| `api.deepseek.com` | `deepseek` | `https://api.deepseek.com/user/balance` |
| `api.z.ai` | `glm` | `https://api.z.ai/api/monitor/usage/quota/limit` |
| `open.bigmodel.cn` | `glm` | `https://open.bigmodel.cn/api/monitor/usage/quota/limit` |
| `api.kimi.com` | `kimi` | `https://api.kimi.com/coding/v1/usages` |
| `api.minimax.io` | `minimax` | `https://api.minimax.io/v1/token_plan/remains` |
| `api.minimaxi.com` | `minimax` | `https://api.minimaxi.com/v1/token_plan/remains` |
| `api.moonshot.cn` | `moonshot` | `https://api.moonshot.cn/v1/users/me/balance` |
| `api.moonshot.ai` | `moonshot` | `https://api.moonshot.ai/v1/users/me/balance` |
| `openrouter.ai` | `openrouter` | `https://openrouter.ai/api/v1/credits` |

因此，DSH 默认的 `zai-coding-cn` 会走 `open.bigmodel.cn`，而 `zai` 会走 `api.z.ai`。如果用户显式修改 `baseURL`，插件跟随修改后的已知主机，不复用旧端点缓存。

小米 MiMo 的主机（`api.xiaomimimo.com` 与 `token-plan-*.xiaomimimo.com`）不映射到推理 Key 的额度接口，而是统一走控制台 Cookie 适配器 `xiaomi-mimo`；详见后文。

阿里云百炼 Token Plan 的主机（`token-plan.*.maas.aliyuncs.com`）同样不能用推理 Key 查额度，插件改走控制台网关适配器 `qwen`；详见后文。

OAuth-only、未知代理、自托管地址和未激活 provider 均返回 `unsupported`，不会向上游发送凭证。自定义代理必须通过 `config.providers` 显式声明额度端点和凭证引用。

## DeepSeek 账号（按量计费）

dsh 的 `deepseek-account` 路由使用账号登录，余额来自 DeepSeek Platform 的钱包，不是 API Key 的 `/user/balance`。

`ctx.deepseekAccount.getBalance()` 返回：

```json
{
  "status": "ready",
  "value": [{ "currency": "CNY", "balance": "65.2768280200000000" }],
  "bonusWallets": [{ "currency": "CNY", "balance": "0" }]
}
```

- `value` 是充值余额，`bonusWallets` 是赠送余额，两者分开。
- 插件把 CNY 钱包作为状态行的主金额，其余钱包在展开面板逐条列出。
- `status` 为 `failed` 属于临时失败：有旧成功余额时返回 `stale`，否则返回 `error`；返回 `null` 或账号未登录时返回 `signed-out` 并清除旧值。
- 调用需要 `AccountClientMetadata`：版本、locale、时区偏移。插件固定传 `0.2.1-rc.2`、`zh_CN` 和本机时区偏移。

## DeepSeek API Key（按量计费）

凭证引用来自 DSH 实时 `apiKeyEnv`，默认为 `DEEPSEEK_API_KEY`：

```http
GET https://api.deepseek.com/user/balance
Authorization: Bearer <实时 apiKeyEnv 对应的 Key>
```

返回：

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

插件读取 `balance_infos[0]` 的 `total_balance`，并保留 `is_available` 供展开面板显示状态。

## OpenRouter（按量余额）

DSH 的 `openrouter` 路由默认使用 `OPENROUTER_API_KEY` 与 `https://openrouter.ai/api/v1`：

```http
GET https://openrouter.ai/api/v1/credits
Authorization: Bearer <实时凭证引用对应的 Key>
```

返回（字段有裁剪）：

```json
{
  "data": {
    "total_credits": 20,
    "total_usage": 4.5
  }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `data.total_credits` | 账户累计购买额度 |
| `data.total_usage` | 账户累计消耗 |

注意：

- 剩余额度 = `total_credits - total_usage`，最小为 0；币种固定为 USD。
- `total_credits` 缺失时按临时失败处理；`total_usage` 缺失按 0 处理。
- 该接口返回账户级额度，不是单个 Key 的消费上限；单 Key 的 `limit` / `limit_remaining` 在 `/api/v1/key`，当前版本不展示。

## GLM Coding Plan

国际站使用 `api.z.ai`，DSH 默认的 `zai-coding-cn` 使用 `open.bigmodel.cn`；凭证来自实时 `apiKeyEnv` 或 `nativeAuth.env`：

```http
GET https://<实时已知主机>/api/monitor/usage/quota/limit
Authorization: Bearer <实时凭证引用对应的 Key>
```

返回（字段有裁剪）：

```json
{
  "code": 200,
  "success": true,
  "data": {
    "level": "lite",
    "limits": [
      { "type": "TIME_LIMIT", "unit": 5, "percentage": 0, "nextResetTime": 1793019108980 },
      { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 0 }
    ]
  }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `data.level` | 套餐等级，显示为 `GLM Lite` / `GLM Pro` 等 |
| `TOKENS_LIMIT` + `unit: 3` | 5 小时额度 |
| `TOKENS_LIMIT` + `unit: 6` | 周额度 |
| `TIME_LIMIT` + `unit: 5` | Web Search / Reader / Zread 等月度工具额度，插件不显示 |
| `percentage` | **已用**百分比，剩余 = `100 - percentage` |
| `nextResetTime` | 下次重置时间，毫秒时间戳 |

注意：

- 当前账户可能只返回 `unit: 3`，没有 `unit: 6`。插件按实际存在的条目渲染，不补零。
- `unit` 缺失或出现新值时，按 `TOKENS_LIMIT` 的顺序兜底，但已知 `unit: 6` 不会成为 5 小时候选，两个窗口也不会引用同一条目；仅有 `unit: 6` 时只显示周额度。
- 如果存在 `usage` / `remaining` 而没有 `percentage`，插件用 `(usage - remaining) / usage` 计算已用比例。

## Kimi For Coding

DSH 原生环境引用为 `KIMI_API_KEY`；如果 profile 显式设置 `apiKeyEnv: KIMI_CODING_API_KEY`，插件与该设置保持一致：

```http
GET https://api.kimi.com/coding/v1/usages
Authorization: Bearer <实时凭证引用对应的 Key>
```

返回（字段有裁剪）：

```json
{
  "usages": {
    "limit_5h": { "used_ratio": 0.9309, "reset_time": "2026-10-24T11:30:21Z" },
    "limit_7d": { "used_ratio": 0.6607, "reset_time": "2026-10-30T02:30:22Z" }
  },
  "usage": { "limit": "100", "used": "66", "remaining": "34", "resetTime": "2026-10-30T02:30:22Z" },
  "limits": [
    {
      "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" },
      "detail": { "limit": "100", "used": "93", "remaining": "7", "resetTime": "2026-10-24T11:30:22Z" }
    }
  ]
}
```

解析优先级：

1. `usages.limit_5h` / `usages.limit_7d` 的 `used_ratio`（0–1）与 `reset_time`。
2. 缺少时，用 `limits` 中 `window.duration === 300` 的 `detail` 计算 5 小时额度。
3. 缺少周额度时，用 `usage` 的 `limit` / `remaining` / `resetTime` 计算。

注意：

- 新套餐可能没有周额度；此时只显示 5 小时。
- `booster_wallet` 是加油包信息，当前版本不展示。
- 这是 Kimi For Coding 的接口，不是 Moonshot 开放平台的 `/v1/users/me/balance`。后者只适合按量计费的 Moonshot API Key。

## Moonshot 开放平台（按量余额）

Moonshot 按量计费与 Kimi For Coding 是两套独立产品：`moonshotai` / `moonshotai-cn` 是开放平台余额，`kimi-coding` 是 Coding Plan。插件按推理主机区分，不会把余额数据挂到 Coding Plan 路由上。

```http
GET https://api.moonshot.cn/v1/users/me/balance
GET https://api.moonshot.ai/v1/users/me/balance
Authorization: Bearer <实时 MOONSHOT_API_KEY>
```

返回（字段有裁剪）：

```json
{
  "code": 0,
  "data": {
    "available_balance": 49.58894,
    "voucher_balance": 46.58893,
    "cash_balance": 3.00001
  },
  "scode": "0x0",
  "status": true
}
```

- `available_balance` 是可用总额（现金 + 代金券），作为状态行主金额。
- `cash_balance` 显示为「充值余额」，`voucher_balance` 显示为「赠送余额」。
- `.cn` 主机按 CNY 显示，`.ai` 主机按 USD 显示。
- `code` 非 0 或 `status: false` 按业务错误处理；`missing-credential` 是终态，客户端显示「未配置 API Key」。

## MiniMax Coding Plan / M Plan

DSH 的 `minimax` 与 `minimax-cn` 使用订阅 Key（`MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY`），额度按「prompt 次数」计算，分为动态 5 小时窗口与周窗口：

```http
GET https://api.minimax.io/v1/token_plan/remains
GET https://api.minimaxi.com/v1/token_plan/remains
Authorization: Bearer <实时凭证引用对应的 Key>
```

返回（字段有裁剪）：

```json
{
  "base_resp": { "status_code": 0, "status_msg": "success" },
  "model_remains": [
    {
      "model_name": "MiniMax-M2.5",
      "end_time": 1760018000000,
      "current_interval_total_count": 1500,
      "current_interval_usage_count": 1245,
      "current_interval_remaining_percent": 83,
      "weekly_end_time": 1760604800000,
      "current_weekly_total_count": 10000,
      "current_weekly_usage_count": 8000,
      "current_weekly_remaining_percent": 80
    }
  ]
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `current_interval_remaining_percent` | 服务器预算的 5 小时窗口**剩余**百分比（优先使用） |
| `current_interval_total_count` | 当前 5 小时窗口总额度 |
| `current_interval_usage_count` | 当前窗口**剩余**额度（字段名带 usage，但语义是剩余） |
| `current_weekly_remaining_percent` | 服务器预算的周窗口剩余百分比（优先使用） |
| `current_weekly_total_count` | 周窗口总额度 |
| `current_weekly_usage_count` | 周窗口**剩余**额度 |
| `end_time` / `weekly_end_time` | 窗口重置时间，毫秒时间戳 |
| `model_remains[].model_name` | 模型名；面板标题显示为 `MiniMax · <model>` |

注意：

- 已用比例 = `100 - remaining`；没有百分比字段时回退到 `total - remaining` 计算，不能把 `current_interval_usage_count` 当作已用次数。
- `model_remains` 的第一条有效条目是账号的规范额度状态，后续条目是视频等细分模型桶；插件只读取第一条能解析出窗口的条目。
- 新 M Plan 使用 `/v1/token_plan/remains`，旧 Coding Plan 使用 `/v1/coding_plan/remains`；两个端点响应结构相同。同一个 Key 不一定被两者都接受，插件在业务错误时自动尝试同一主机下的另一个端点。自定义 `config.providers` 的 `endpoint` 不在上述两个路径时不做回退。
- `base_resp.status_code` 非 0 按业务错误处理；`missing-credential` 是终态，客户端显示「未配置 API Key」。

## 阿里云百炼 Qwen Token Plan

DSH 的 `qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual` 使用 Token Plan 专属推理 Key（`sk-sp-*`）。该 Key 只能调用模型，不能查询套餐额度；额度必须通过控制台网关读取。插件复用官方 Model Studio CLI 的控制台 API，因此需要额外的**控制台 access token**，而不是推理 Key。

获取方式：

1. 安装并登录官方 CLI：`bl auth login --console`。
2. 从 `~/.bailian/config.json` 复制 `access_token`，写入 DSH 凭据库的 `QWEN_CONSOLE_TOKEN`（也兼容 `BAILIAN_CONSOLE_TOKEN`）。

```yaml
refs:
  QWEN_TOKEN_PLAN_CN_API_KEY: sk-sp-...
  QWEN_CONSOLE_TOKEN: "..."
```

> 控制台 token 的权限高于推理 Key，请只在可信机器上保存。

插件按推理主机选择控制台网关：

| DSH provider | 推理主机 | 控制台网关 | region |
| --- | --- | --- | --- |
| `qwen-token-plan-cn` | `token-plan.cn-beijing.maas.aliyuncs.com` | `bailian-cs.console.aliyun.com` | `cn-beijing` |
| `qwen-token-plan` / `qwen-token-plan-individual` | `token-plan.ap-southeast-1.maas.aliyuncs.com` | `bailian-singapore-cs.alibabacloud.com` | `ap-southeast-1` |

请求（与官方 CLI 相同的控制台接口）：

```http
POST https://bailian-cs.console.aliyun.com/cli/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=...
Authorization: Bearer <控制台 access token>
Content-Type: application/x-www-form-urlencoded
```

返回（字段有裁剪）：

```json
{
  "data": {
    "DataV2": {
      "data": {
        "data": {
          "per1MonthPercentage": 0.5,
          "per1MonthResetTime": 1786000000000
        }
      }
    }
  }
}
```

- `per1MonthPercentage` 是 0–1 的**已用**比例，剩余 = `100 - 已用`。
- `per1MonthResetTime` 是毫秒时间戳；为 0 或缺省时不显示重置时间。
- 状态行显示「套餐剩 X%」，展开面板显示月度额度与重置时间。
- 控制台 token 缺失时返回 `missing-console-token`，客户端显示「未配置 Qwen 控制台 Token」。
- 国内账号使用新加坡套餐时，可在 `config.providers` 显式覆盖 `endpoint` 指向 `https://modelstudio-cs.console.aliyun.com/cli/api.json?action=IntlBroadScopeAspnGateway&product=sfm_bailian&api=...`，并设置 `keyNames: [QWEN_CONSOLE_TOKEN]`。

## Xiaomi MiMo 开放平台（按量余额 / Token Plan）

MiMo 的按量计费与 Token Plan 是两套独立产品，对应不同的 DSH provider：`xiaomi`（推理主机 `api.xiaomimimo.com`）和 `xiaomi-token-plan-*`（推理主机 `token-plan-*.xiaomimimo.com`）。余额和 Token Plan 额度只有控制台接口，推理 Key（`sk-*`）和 Token Plan Key（`tp-*` / `ttp-*`）都不能查询。插件因此读取**控制台 Cookie**，凭据引用默认为 `MIMO_COOKIE`，也兼容 `XIAOMI_MIMO_COOKIE`。

插件按 provider 类型选择数据源：按量计费只读取余额，Token Plan 只读取套餐额度，不会把两套数据混在一起显示。

获取方式：登录 `platform.xiaomimimo.com`，打开开发者工具 → Network，找到任意 `/api/v1/` 请求，复制完整的 `Cookie` 请求头（至少包含 `serviceToken` 与 `userId`），写入 DSH 凭据库。Cookie 过期后重新复制。

### 配置步骤

MiMo 需要两份互不替代的凭证：推理 Key（`sk-*`）用于实际调用模型，额度 Cookie 用于读取余额与 Token Plan。

**1. 模型路由**

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`：

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      xiaomi:
        apiKeyEnv: XIAOMI_API_KEY
        # baseURL 默认 https://api.xiaomimimo.com/v1，可省略
      xiaomi-token-plan-cn:
        apiKeyEnv: XIAOMI_TOKEN_PLAN_CN_API_KEY
```

只用按量接口时只保留 `xiaomi`；Token Plan 路由按需添加，Key 使用 `tp-*` / `ttp-*`。插件根据推理主机自动区分：`api.xiaomimimo.com` 只显示余额，`token-plan-*.xiaomimimo.com` 只显示套餐额度。

**2. 额度 Cookie**

编辑 `$DSH_HOME/.credentials.yaml`，在 `refs` 段追加一行（保留已有的 `records` 与其他 refs 不动）：

```yaml
refs:
  XIAOMI_API_KEY: sk-...
  MIMO_COOKIE: "serviceToken=...; userId=..."
```

- 键名默认 `MIMO_COOKIE`，也兼容 `XIAOMI_MIMO_COOKIE`。
- 值必须加引号，因为 Cookie 包含空格和分号。
- 也可以不改文件，改用环境变量 `MIMO_COOKIE`。

**3. 不需要给 llm-quota 增加配置**

只要推理 `baseURL` 的主机属于 `*.xiaomimimo.com`，插件会自动走控制台 Cookie 适配器并推断计费类型。只有想换 Cookie 凭据名、走代理或自定义 provider 名时才需要显式覆盖：

```yaml
- id: llm-quota
  name: '@local/dsh-llm-quota'
  config:
    providers:
      xiaomi:
        kind: xiaomi-mimo
        mode: balance
        endpoint: https://platform.xiaomimimo.com/api/v1
        keyNames: [MY_MIMO_COOKIE]
      my-token-plan:
        kind: xiaomi-mimo
        mode: plan
        endpoint: https://platform.xiaomimimo.com/api/v1
        keyNames: [MY_MIMO_COOKIE]
```

显式覆盖会整体替换自动解析结果，因此 `endpoint` 与 `keyNames` 都要写。`mode` 可选值为 `balance`（只查余额）或 `plan`（只查 Token Plan）；不写时按 provider id 推断，识别不出则保留旧的「余额 + 套餐」行为。pi-ai 的 provider profile 没有 `cookieEnv` 字段，自定义 Cookie 名请用这里的 `llm-quota.config.providers`，不要写进 `llm-pi-ai.providers.xiaomi`。

**4. 生效与验证**

重启 dsh 或刷新页面，在已有会话中查看输入框下方的状态行；未配置 Cookie 时会显示「未配置 MiMo 控制台 Cookie」。

适配器按 provider 类型并行请求对应控制台接口（均需 Cookie）：

按量计费（`mode: balance`）：

```http
GET https://platform.xiaomimimo.com/api/v1/balance
GET https://platform.xiaomimimo.com/api/v1/userProfile
Cookie: serviceToken=<...>; userId=<...>
x-timezone: Asia/Shanghai
```

Token Plan（`mode: plan`）：

```http
GET https://platform.xiaomimimo.com/api/v1/tokenPlan/usage
GET https://platform.xiaomimimo.com/api/v1/tokenPlan/detail
Cookie: serviceToken=<...>; userId=<...>
x-timezone: Asia/Shanghai
```

未指定 `mode` 的显式自定义覆盖仍会同时请求以上四个接口。

返回（字段有裁剪）：

```json
{
  "code": 0,
  "data": {
    "balance": "65.27",
    "cashBalance": "60.00",
    "giftBalance": "5.27",
    "frozenBalance": "0"
  }
}
```

```json
{
  "code": 0,
  "data": {
    "usage": {
      "items": [{ "name": "plan_total_token", "used": 25000000, "limit": 100000000, "percent": 0.25 }]
    },
    "monthUsage": {
      "items": [{ "name": "month_total_token", "used": 5000000, "limit": 100000000, "percent": 0.05 }]
    }
  }
}
```

- 按量计费只返回 `amount`、`cashBalance`、`giftBalance`、`frozenBalance` 与 `currency`，不再附带 `plan`。
- Token Plan 只返回 `plan`，不再附带余额字段。
- 响应中的 `mode`（`balance` / `plan`）供客户端区分标题与图标；未指定模式的自定义覆盖不返回该字段。
- `balance` 是剩余总额，`cashBalance` 与 `giftBalance` 是拆分项；`amount` 取 `balance`，缺失时回退 `cashBalance`。
- 币种按 `userProfile.idc` 判断：`310` 为 `CNY`，其他为 `USD`；Token Plan 模式不请求 `userProfile`。
- `usage.items` 中的 `plan_total_token` 是套餐窗口，`compensation_total_token` 是补偿积分；`monthUsage.items` 中的 `month_total_token` 是本月用量。
- `percent` 是 0–1 的小数；插件优先用 `used / limit` 计算百分比，字段缺失时回退 `percent`。
- `tokenPlan/detail` 提供 `planName` 与 `currentPeriodEnd`，后者作为套餐窗口的重置时间。
- 对应模式的接口可用即返回成功；按量模式无余额、Token Plan 模式无套餐窗口时按临时失败处理。`missing-cookie` 是终态，客户端显示「未配置 MiMo 控制台 Cookie」。
- 自动解析覆盖 `xiaomi`、`xiaomi-token-plan-cn`、`xiaomi-token-plan-sgp`、`xiaomi-token-plan-ams` 等已知主机，并按主机推断 `mode`；自定义代理可在 `config.providers` 中用 `kind: xiaomi-mimo` 显式指定 `mode`、`endpoint`（控制台 API 基地址）和 `keyNames`。

## 自定义或增加 provider

### 自定义代理或显式覆盖

未知代理不会从推理 `baseURL` 自动猜测额度地址。在插件行的 `config.providers` 中显式声明完整适配器，不需要改代码：

```yaml
- id: llm-quota
  name: '@local/dsh-llm-quota'
  config:
    providers:
      my-glm:
        kind: glm
        endpoint: https://api.z.ai/api/monitor/usage/quota/limit
        keyNames: [MY_GLM_API_KEY]
      my-kimi:
        kind: kimi
        endpoint: https://api.kimi.com/coding/v1/usages
        keyNames: [MY_KIMI_KEY]
```

`kind` 必须是已有适配器：`account`、`deepseek`、`glm`、`kimi`、`minimax`、`moonshot`、`openrouter`、`qwen`、`xiaomi-mimo`。某个 provider 的显式配置会整体替代自动解析结果，因此自定义 GLM/Kimi/MiniMax/Moonshot/OpenRouter 应同时提供 `endpoint` 和 `keyNames`；`xiaomi-mimo` 的 `endpoint` 是控制台 API 基地址（默认 `https://platform.xiaomimimo.com/api/v1`），`keyNames` 填控制台 Cookie 的凭据引用，`mode` 可选 `balance` 或 `plan`；`qwen` 的 `endpoint` 是控制台 `cli/api.json` 完整地址，`keyNames` 默认取 `QWEN_CONSOLE_TOKEN` / `BAILIAN_CONSOLE_TOKEN`。显式覆盖不要求 DSH 中存在同名激活路由。

### 接入新的额度体系

供应商兼容代码集中在 `providers/` 目录：

| 文件 | 职责 |
| --- | --- |
| `providers/index.js` | 适配器注册表：主机 → 端点映射、按 `kind` 分发 `readQuota` |
| `providers/resolve.js` | 从 DSH 实时配置解析 provider 的凭证引用与 `baseURL` |
| `providers/shared.js` | 凭证读取、上游 HTTP、缓存指纹与统一响应片段 |
| `providers/<kind>.js` | 单个额度体系的解析逻辑 |

接入步骤：

1. 在 `providers/` 新建适配器模块，导出 `kind`、`hosts`（已知 HTTPS 主机 → 固定额度端点，没有则用空对象）和 `read(ctx, route)`。
2. 在 `providers/index.js` 的 `ADAPTERS` 数组注册该模块。
3. 如果新供应商的凭证引用或 `baseURL` 来自新的 DSH 插件，在 `providers/resolve.js` 增加一个分支。
4. 让新适配器返回统一结构：

```json
{
  "ok": true,
  "provider": "<route>",
  "kind": "<kind>",
  "fiveHour": { "usedPercent": 0, "remainingPercent": 100, "resetAt": "<ISO>" },
  "weekly": { "usedPercent": 0, "remainingPercent": 100, "resetAt": "<ISO>" },
  "updatedAt": "<ISO>"
}
```

余额型则返回 `kind: "balance"`、`currency`、`amount`、`wallets`、`bonusWallets`。

5. 如果新类型需要不同的状态行文案，在 `client.js` 的 `compactLabel` / `panelTitle` 中增加分支和 `zh`/`en` 字典键。

## 接口稳定性

- DeepSeek 账号余额走 dsh 内部服务，稳定性由 dsh 版本决定。
- DeepSeek API Key 余额是官方公开接口。
- Z.AI / 智谱 与 Kimi 的额度接口不是公开文档 API，属于其前端或 CLI 正在使用的接口；字段或路径变化时，只需调整对应适配器。
- GLM/Kimi 只返回一个有效额度窗口是合法情况；完全无法识别的响应按临时失败处理，不会覆盖旧成功数据。
- Loader 实时配置读取与 manifest 兼容声明当前针对 DSH `0.2.1-rc.2`，升级后需重新核对配置结构。
