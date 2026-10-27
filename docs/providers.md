# 供应商适配

插件按「当前会话所选模型的 provider id」选择额度适配器。provider id 是 DSH 模型路由的名字，例如 profile 中 `llm-pi-ai.providers` 的键。插件不根据名称猜测供应商，而是读取 DSH 当前激活路由的实时配置。

## 支持的额度体系

| 供应商 | provider id 示例 | `kind` | 凭证引用 | 额度来源 |
| --- | --- | --- | --- | --- |
| DeepSeek 账号 | `deepseek-account` | `account` | DSH 账号登录 | `ctx.deepseekAccount.getBalance()` |
| DeepSeek API Key | `deepseek-official` | `deepseek` | 实时 `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`） | `api.deepseek.com/user/balance` |
| Baseten | `baseten` | `baseten` | `BASETEN_API_KEY` | `api.baseten.co/v1/billing/usage_summary` |
| Fireworks AI | `fireworks` | `fireworks` | `FIREWORKS_API_KEY` | `/v1/accounts` + `/v1/accounts/{id}/billing/summary` |
| GLM Coding Plan | `zai`、`zai-coding-cn` | `glm` | 实时 `apiKeyEnv` / `nativeAuth.env` | `api.z.ai` / `open.bigmodel.cn` 的配额接口 |
| Kimi For Coding | `kimi-coding` | `kimi` | `KIMI_API_KEY` 或 profile 的 `apiKeyEnv` | `api.kimi.com/coding/v1/usages` |
| MiniMax Coding Plan | `minimax`、`minimax-cn` | `minimax` | `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY` | `/v1/token_plan/remains`（旧端点 `/v1/coding_plan/remains`） |
| Moonshot 开放平台 | `moonshotai`、`moonshotai-cn` | `moonshot` | `MOONSHOT_API_KEY` | `/v1/users/me/balance` |
| OpenRouter | `openrouter` | `openrouter` | `OPENROUTER_API_KEY` | `/api/v1/credits` |
| Together AI | `together` | `together` | `TOGETHER_API_KEY` | `/v1/billing/usage` |
| Vercel AI Gateway | 指向 `ai-gateway.vercel.sh` 的路由 | `vercel-gateway` | `AI_GATEWAY_API_KEY` | `/v1/credits` |
| xAI | `xai` | `xai` | `XAI_MANAGEMENT_KEY`（Management Key） | `management-api.x.ai` 的账单接口 |
| Qwen Token Plan | `qwen-token-plan*` | `qwen` | `QWEN_CONSOLE_TOKEN` / `BAILIAN_CONSOLE_TOKEN` | 阿里云百炼控制台网关 |
| Xiaomi MiMo | `xiaomi`、`xiaomi-token-plan-*` | `xiaomi-mimo` | `MIMO_COOKIE` / `XIAOMI_MIMO_COOKIE` | `platform.xiaomimimo.com/api/v1` |
| Radius | `radius` | `radius` | `RADIUS_API_KEY` | `/v1/organizations` + `/v1/organizations/{id}/billing` |
| Hugging Face | `huggingface` | `huggingface` | `HF_TOKEN` / `HUGGINGFACE_TOKEN` | `huggingface.co/api/settings/billing/usage-v2` |
| OpenCode Go | `opencode-go` | `opencode-go` | `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY` | `opencode.ai/zen/go/v1/usage` |
| GitHub Copilot | `github-copilot` | `github-copilot` | `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN` | `api.github.com/copilot_internal/user` |
| Anthropic | `anthropic` | `anthropic` | `ANTHROPIC_ADMIN_KEY`（Admin Key） | `/v1/organizations/cost_report` |
| OpenAI | `openai` | `openai` | `OPENAI_ADMIN_KEY`（Admin Key） | `/v1/organization/costs` |
| Cloudflare Workers AI / AI Gateway | 指向 `api.cloudflare.com` / `gateway.ai.cloudflare.com` / `*.workers.dev` 的路由 | `cloudflare` | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | `/client/v4/accounts/{id}/ai-gateway/billing/*` |
| OpenAI Codex | `openai-codex` | `openai-codex` | `OPENAI_CODEX_TOKEN` + `OPENAI_CODEX_ACCOUNT_ID` | `chatgpt.com/backend-api/wham/usage` |

Baseten、Fireworks AI、Together AI 官方没有余额接口，插件显示的是**当月已用金额**（状态行「本月已用 $X」），不是余额或套餐百分比；Hugging Face、Anthropic、OpenAI 同属此类（Hugging Face 无金额时降级显示本月请求数）。

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
| `ai-gateway.vercel.sh` | `vercel-gateway` | `https://ai-gateway.vercel.sh/v1/credits` |
| `inference.baseten.co` | `baseten` | `https://api.baseten.co/v1/billing/usage_summary` |
| `api.fireworks.ai` | `fireworks` | `https://api.fireworks.ai/v1`（基地址，适配器补全路径） |
| `api.together.ai` | `together` | `https://api.together.ai/v1/billing/usage` |
| `api.x.ai`、`management-api.x.ai` | `xai` | `https://management-api.x.ai`（基地址，走 Management Key） |
| `radius.pi.dev` | `radius` | `https://radius.pi.dev`（基地址，适配器补全组织与账单路径） |
| `router.huggingface.co` | `huggingface` | `https://huggingface.co/api/settings/billing/usage-v2` |
| `api.individual.githubcopilot.com`、`api.business.githubcopilot.com`、`api.enterprise.githubcopilot.com` | `github-copilot` | `https://api.github.com/copilot_internal/user` |
| `api.anthropic.com` | `anthropic` | `https://api.anthropic.com/v1/organizations/cost_report` |
| `api.openai.com` | `openai` | `https://api.openai.com/v1/organization/costs` |

因此，DSH 默认的 `zai-coding-cn` 会走 `open.bigmodel.cn`，而 `zai` 会走 `api.z.ai`。如果用户显式修改 `baseURL`，插件跟随修改后的已知主机，不复用旧端点缓存。

少数适配器不靠静态主机映射，而是由 `resolve.js` 用 `routeFor` 按 URL 匹配：`opencode-go` 只认 `opencode.ai` 下的 `/zen/go` 路径（纯 `/zen` 是 Zen 预付费产品，不解析），`openai-codex` 只认 `chatgpt.com` 下含 `/backend-api` 的路径，`cloudflare` 认 `api.cloudflare.com` / `gateway.ai.cloudflare.com` / `*.workers.dev`（账户 ID 是按凭证的，静态映射表达不了），`github-copilot` 也接受任意 `*.githubcopilot.com` 主机。

小米 MiMo 的主机（`api.xiaomimimo.com` 与 `token-plan-*.xiaomimimo.com`）不映射到推理 Key 的额度接口，而是统一走控制台 Cookie 适配器 `xiaomi-mimo`；阿里云百炼 Token Plan 的主机（`token-plan.*.maas.aliyuncs.com`）同样不能用推理 Key 查额度，改走控制台网关适配器 `qwen`。两者的细节见后文。

OAuth-only 路由不再一概返回 `unsupported`：`anthropic` / `openai` / `github-copilot` / `openai-codex` / `cloudflare` / `opencode-go` 的额度走各自的专用凭证（Admin Key、GitHub Token、ChatGPT OAuth Token + Account ID、账户级 API Token + Account ID、OpenCode API Key），与路由的推理认证方式无关，凭证缺失时返回 `missing-credential` 而不是 `unsupported`。其余 OAuth-only 路由、未知代理、自托管地址和未激活 provider 均返回 `unsupported`，不会向上游发送凭证。自定义代理必须通过 `config.providers` 显式声明额度端点和凭证引用。

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

- 已用比例 = `100 - remaining`；没有百分比字段时回退到 `(total - remaining) / total` 计算，不能把 `current_interval_usage_count` 当作已用次数。
- `model_remains` 的第一条有效条目是账号的规范额度状态，后续条目是视频等细分模型桶；插件只读取第一条能解析出窗口的条目。
- 新 M Plan 使用 `/v1/token_plan/remains`，旧 Coding Plan 使用 `/v1/coding_plan/remains`；两个端点响应结构相同。同一个 Key 不一定被两者都接受，插件在业务错误时自动尝试同一主机下的另一个端点。自定义 `config.providers` 的 `endpoint` 不在上述两个路径时不做回退。
- `base_resp.status_code` 非 0 按业务错误处理；`missing-credential` 是终态，客户端显示「未配置 API Key」。

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

## Vercel AI Gateway（按量余额）

DSH 中把 Vercel AI Gateway 作为 provider 时，推理主机为 `ai-gateway.vercel.sh`，凭证引用通常是 `AI_GATEWAY_API_KEY`：

```http
GET https://ai-gateway.vercel.sh/v1/credits
Authorization: Bearer <实时凭证引用对应的 AI Gateway API Key>
```

返回（字段有裁剪）：

```json
{
  "balance": "95.50",
  "total_used": "4.50"
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `balance` | API Key 所属团队的剩余 AI Gateway Credits，单位 USD |
| `total_used` | 团队累计消耗，单位 USD |

注意：

- 额度属于 API Key 所属团队，不需要额外传 team id。
- `balance` 缺失时按临时失败处理；`total_used` 缺失时不显示「已使用」。
- Vercel 部署也可以使用 OIDC token，但本插件只读取 DSH 凭据库中的 API Key，不读取 `VERCEL_OIDC_TOKEN`。

## Baseten（本月已用）

Baseten 没有余额接口，`/v1/billing/usage_summary` 报告时间段内的费用拆分。插件查询当前 UTC 自然月并显示本月已用：

```http
GET https://api.baseten.co/v1/billing/usage_summary?start_date=<月初>&end_date=<次日>
Authorization: Bearer <实时 BASETEN_API_KEY>
```

返回（字段有裁剪）：

```json
{
  "dedicated_usage": null,
  "training_usage": null,
  "model_apis_usage": { "subtotal": 3, "credits_used": 1, "total": 4 }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `total` | 该类别的总费用（USD），三个类别求和作为「本月已用」 |
| `credits_used` | 抵扣掉的赠送额度（USD），面板显示为「已用抵扣」 |
| `subtotal` | 扣除抵扣后的实付费用（USD），面板显示为「实付小计」 |

注意：

- 三个类别为 `dedicated_usage` / `training_usage` / `model_apis_usage`，为 `null` 表示该类别无用量，不是错误。
- `start_date` / `end_date` 是 UTC 时间，跨度不超过 31 天；插件用月初到次日，保证当天数据完整。
- 该接口也是 Management API 的一部分，普通推理 Key 即可调用（`Authorization: Bearer`，兼容旧式 `Api-Key`）。

## Fireworks AI（本月已用）

Fireworks 没有余额接口，插件用账单汇总显示当前 UTC 自然月的已产生费用。API Key 不绑定账号 id，需要先做账号发现：

```http
GET https://api.fireworks.ai/v1/accounts
Authorization: Bearer <实时 FIREWORKS_API_KEY>
```

再按账号查询账单（`endTime` 为排他边界，插件取次日以覆盖当天）：

```http
GET https://api.fireworks.ai/v1/accounts/<account_id>/billing/summary?startTime=<月初>&endTime=<次日>
Authorization: Bearer <实时 FIREWORKS_API_KEY>
```

返回（字段有裁剪）：

```json
{
  "lineItems": [
    {
      "category": "Text Completion",
      "groupingValue": "accounts/fireworks/models/kimi-k2.6",
      "quantity": 1842301,
      "totalCost": { "currencyCode": "USD", "units": "12", "nanos": 340000000 }
    }
  ]
}
```

- `totalCost` 是 `typeMoney`：`units` 为整数美元、`nanos` 为 10^-9 美元；所有 `lineItems` 求和作为「本月已用」。
- 账号 `name` 形如 `accounts/my-account`，请求账单时取末段作为 `account_id`。
- 一个 Key 能看到多个账号时，插件把所有账号的账单求和，不做猜测或挑选。
- 配额接口 `/v1/accounts/{id}/quotas` 的 `monthly-spend-usd` 默认值是 9,999,999（等同不限额），不代表用户预算，插件因此不显示额度百分比。

## Together AI（本月已用）

Together 已下线历史上的余额接口（`/v1/billing/credit`），现行的用量接口按月报告费用行项目：

```http
GET https://api.together.ai/v1/billing/usage?month=<YYYY-MM>
Authorization: Bearer <实时 TOGETHER_API_KEY>
```

返回（字段有裁剪）：

```json
{
  "object": "list",
  "billing_period": "2026-06",
  "currency": "USD",
  "data": [
    {
      "date": "2026-06-01",
      "line_items": [
        { "product_name": "Serverless Inference - Input Tokens", "cost": "0.246913" }
      ]
    }
  ]
}
```

- `data[].line_items[].cost` 求和作为「本月已用」，币种取 `currency`（缺省按 USD）。
- `month` 缺省为当月；插件显式传当前 UTC 自然月。
- 该接口为 beta，按组织开通；未开通的账号返回 404，按临时失败处理。

## xAI（预付余额）

xAI 的推理 API Key 不能查询账单；余额与账单在独立的 Management API（`https://management-api.x.ai`）上，需要控制台创建的 **Management Key**（只读、Team 作用域）。获取方式：console.x.ai → Settings → Management Keys。凭证引用默认 `XAI_MANAGEMENT_KEY`，兼容 `XAI_MANAGEMENT_API_KEY`。

插件按以下步骤读取：

```http
GET https://management-api.x.ai/auth/management-keys/validation
Authorization: Bearer <Management Key>
```

返回（字段有裁剪）：

```json
{ "teamId": "65c1e471-...", "scope": "SCOPE_TEAM", "scopeId": "65c1e471-..." }
```

`scope` 为 `SCOPE_TEAM` 时用 `scopeId` 作为 team id（兼容旧字段 `teamId`）；无法确定单一 team 的 Key 按临时失败处理，不做多团队汇总。随后并行请求：

```http
GET https://management-api.x.ai/v1/billing/teams/<team_id>/prepaid/balance
GET https://management-api.x.ai/v1/billing/teams/<team_id>/postpaid/invoice/preview
Authorization: Bearer <Management Key>
```

返回（字段有裁剪）：

```json
{ "changes": [], "total": { "val": "-4500" } }
```

```json
{ "coreInvoice": { "totalWithCorr": { "val": "1234" } }, "billingCycle": { "year": 2026, "month": 10 } }
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `total.val` | 预付余额会计总额，单位 USD 美分，**负数代表可用余额**；插件取 `-val / 100` 作为「剩余额度」，下限 0 |
| `coreInvoice.totalWithCorr.val` | 当前账期已消费金额（USD 美分），显示为「本期已用」 |
| `billingCycle` | 月度账期，每月 1 日重置 |

注意：

- Management Key 与推理 Key 是两份互不替代的凭证：推理 Key 配在 `llm-pi-ai` 路由上，Management Key 写入凭据库（推荐在插件配置页的「供应商额外凭证」中填写）。
- `invoice/preview` 失败不影响余额显示，只是少一行「本期已用」。

## 阿里云百炼 Qwen Token Plan

DSH 的 `qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual` 使用 Token Plan 专属推理 Key（`sk-sp-*`）。该 Key 只能调用模型，不能查询套餐额度；额度必须通过控制台网关读取。插件复用官方 Model Studio CLI 的控制台 API，因此需要额外的**控制台 access token**，而不是推理 Key。

获取方式：

1. 安装并登录官方 CLI：`bl auth login --console`。
2. 从 `~/.bailian/config.json` 复制 `access_token`，推荐直接在插件配置页的「Qwen 控制台 Access Token」中保存；也可以写入 DSH 凭据库的 `QWEN_CONSOLE_TOKEN`（也兼容 `BAILIAN_CONSOLE_TOKEN`）。

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

推荐在 Web 侧边栏 **Plugins → Installed plugins → 模型额度** 的「供应商额外凭证」中填写 Cookie；也可以手动编辑 `$DSH_HOME/.credentials.yaml`，在 `refs` 段追加一行（保留已有的 `records` 与其他 refs 不动）：

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
  name: '@cs-qyzhang/dsh-llm-quota'
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

## Radius（余额 + 本期已用）

Radius 是 Pi / Earendil AI 网关（`radius.pi.dev`）。API Key 是组织级网关 bearer 凭证，一个 Key 只绑定一个组织，所以插件先通过组织列表发现组织 id，再读取账单汇总，一次拿到余额与本期（UTC 当月）已产生费用。凭证引用默认 `RADIUS_API_KEY`：

```http
GET https://radius.pi.dev/v1/organizations
Authorization: Bearer <RADIUS_API_KEY>
```

从 `organizations` 中取 `selected: true` 的条目（没有则取第一条）的 `id`，随后：

```http
GET https://radius.pi.dev/v1/organizations/<org_id>/billing
Authorization: Bearer <RADIUS_API_KEY>
```

返回（字段有裁剪）：

```json
{
  "ok": true,
  "currency": "USD",
  "balance": { "available": 45, "credit_balance": 40, "reserved": 5 },
  "current_period": { "actual_charged": 12.34 },
  "all_time": { "actual_charged": 123.45 }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `balance.available` | 剩余额度，状态行主金额 |
| `current_period.actual_charged` | 本期已用，面板显示「本期已用」 |
| `balance.credit_balance` / `balance.reserved` | 信用余额 / 预留金额，附加信息 |
| `all_time.actual_charged` | 历史累计已用，附加信息 |
| `currency` | 币种，缺省按 USD |

注意：

- 状态行显示「余额 $X」，金额是响应币种的浮点数。
- `ok` 非 `true`、组织列表为空或缺 `id`、`balance.available` / `current_period.actual_charged` 缺失都按临时失败处理。
- `missing-credential` 是终态，客户端显示「未配置 API Key」。

## Hugging Face（本月已用）

Hugging Face 没有余额接口，插件读取 Hub 的账单用量接口（`usage-v2`），按当前 UTC 自然月汇总已产生费用。凭证引用默认 `HF_TOKEN`，兼容 `HUGGINGFACE_TOKEN`：

```http
GET https://huggingface.co/api/settings/billing/usage-v2?startDate=<月初 Unix 秒>&endDate=<次月 Unix 秒>
Authorization: Bearer <HF_TOKEN>
```

`startDate` / `endDate` 是必填的整数 Unix 时间戳（秒）。响应 schema 未写进 Hub OpenAPI，适配器兼容兄弟账单接口的几种行结构：`usage` / `sessions` 行（`{usage: rows | {分组: rows}, period}`）、`periods` 分组（`{periods: [{period, usage|sessions: rows}]}`）或它们的数组。用量行与顶层字段：

| 字段 | 含义 |
| --- | --- |
| `costCents` | 费用（美分），除以 100 计入「本月已用」 |
| `totalCostMicroUSD`（兼容 `totalCostMicroUsd`） | 费用（微美元），除以 10^6 计入「本月已用」 |
| `requestCount` / `inputTokens` / `outputTokens` / `cachedInputTokens` | 请求数与 token 数，逐行累加 |
| `creditsRemaining` / `remainingCredits` / `creditsRemainingCents` | 剩余 Credits（顶层可选字段，附加信息） |

注意：

- 状态行显示「本月已用 $X」；行内只有计数没有金额时返回 `usageOnly: true`，状态行降级为「本月已用 N 次」（请求数），不虚构金额。
- 金额字段只出现一个就按其口径换算，多个同时出现会叠加求和。
- 行结构或字段完全无法识别时按临时失败处理。

## OpenCode Go（5h / 周 / 月订阅额度）

OpenCode Go 是 opencode.ai 上的订阅产品，额度端点固定为 `GET https://opencode.ai/zen/go/v1/usage`。`opencode.ai` 同时承载 Zen 与 Go，按主机无法区分，插件按 URL 路径识别：`baseURL` 为 `opencode.ai` 且路径以 `/zen/go` 开头才是 Go，纯 `/zen` 是预付费 Zen 产品，不解析。凭证引用默认 `OPENCODE_GO_API_KEY`，兼容 `OPENCODE_API_KEY`：

```http
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <OPENCODE_GO_API_KEY>
```

返回（字段有裁剪）：

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 20, "resetsAt": "2026-10-24T15:30:00Z" },
    "weekly": { "status": "ok", "percent": 50, "resetsAt": "2026-10-30T02:30:00Z" },
    "monthly": { "status": "ok", "percent": 80, "resetsAt": "2026-11-01T00:00:00Z" }
  }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `usage.rolling` | 5 小时滚动窗口（月上限的 20%） |
| `usage.weekly` | 周窗口（月上限的 50%） |
| `usage.monthly` | 月窗口（月上限的 100%） |
| `percent` | **已用**百分比（0–100），剩余 = `100 - percent` |
| `status` | `ok` / `rate-limited`；任一窗口 `rate-limited` 时结果带 `status: "rate-limited"` |
| `resetsAt` | 窗口重置时间，ISO 8601 |

注意：

- 状态行显示「5h 剩 X% · 周 剩 Y%」，月窗口在展开面板显示为「月额度」。
- `percent` 的语义是**已用**不是剩余，与社区同源工具（opencode-plan-usage 等）的进度条一致：新窗口是 0%，`rate-limited` 时到 100%。
- `rolling` 与 `weekly` 缺失按临时失败处理；`monthly` 可选，缺失时面板少一行。

## GitHub Copilot（Premium 请求额度）

GitHub Copilot 是订阅制额度，不走推理 Key 余额。插件读取 VS Code Copilot 扩展正在使用的内部接口 `GET https://api.github.com/copilot_internal/user`，推理主机 `api.individual.githubcopilot.com` / `api.business.githubcopilot.com` / `api.enterprise.githubcopilot.com`（任意 `*.githubcopilot.com`）都映射到该端点。凭证是 GitHub Token（`gho_` / `ghu_` / `ghp_` 或 PAT），引用默认 `COPILOT_GITHUB_TOKEN`，兼容 `GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_COPILOT_TOKEN`：

```http
GET https://api.github.com/copilot_internal/user
Authorization: Bearer <GitHub Token>
```

返回（字段有裁剪）：

```json
{
  "copilot_plan": "pro",
  "quota_reset_date": "2026-11-01T00:00:00Z",
  "quota_snapshots": {
    "premium_interactions": { "percent_remaining": 80, "entitlement": 300, "quota_remaining": 240 },
    "chat": { "percent_remaining": 65 }
  }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `quota_snapshots.premium_interactions` | Premium 请求额度，状态行「套餐剩 X%」 |
| `percent_remaining` | 剩余百分比（优先使用）；缺失时用 `quota_remaining / entitlement` 推算 |
| `unlimited` / `overage_permitted` | 任一为 `true` 时按不限量处理 |
| `copilot_plan` | 套餐名（`pro` / `business` 等），面板标题显示 `GitHub Copilot · <plan>` |
| `quota_snapshots.chat` | Chat 额度，面板显示「Chat 额度」 |
| `quota_reset_date` | 额度重置时间 |

注意：

- 这是**非官方内部接口**，字段或可用性可能随时变化；403 / 404 等按临时失败处理，不做回退。
- 官方 REST 替代 `GET /users/{username}/settings/billing/premium_request/usage`（fine-grained PAT，`Plan: read` 权限）当前版本未实现。
- 凭证缺失返回 `missing-credential`，客户端显示「未配置 GitHub Token」。

## Anthropic（本月已用）

Anthropic 没有余额接口，插件读取 Admin API 的成本报表，显示当前 UTC 自然月已产生费用。需要组织 **Admin API Key**（`sk-ant-admin…`，Claude Console → Settings → Admin Keys 创建），Messages 用的推理 Key 不能查询；凭证引用默认 `ANTHROPIC_ADMIN_KEY`，兼容 `ANTHROPIC_ADMIN_API_KEY`：

```http
GET https://api.anthropic.com/v1/organizations/cost_report?starting_at=<月初>&ending_at=<次月>&bucket_width=1d
x-api-key: <Admin Key>
anthropic-version: 2023-06-01
```

返回（字段有裁剪）：

```json
{
  "data": [
    {
      "results": [
        { "amount": "1234.56", "cost_type": "tokens" },
        { "amount": "100.00", "cost_type": "web_search" }
      ]
    }
  ]
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `amount` | 该行费用，**USD 美分**（`"1234.56"` = $12.35），全部行求和后除以 100 得「本月已用」 |
| `cost_type` | 费用类型（`tokens` / `web_search` 等），按类型汇总为附加信息（`costTypeBreakdown`） |

插件会附带请求用量报表补充 token 统计（失败只丢弃附加信息，不影响本月已用）：

```http
GET https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=<月初>&ending_at=<次月>&bucket_width=1d
```

其 `results` 行的 `uncached_input_tokens`、`cache_read_input_tokens`、`cache_creation.ephemeral_5m_input_tokens`、`cache_creation.ephemeral_1h_input_tokens` 计入输入，`output_tokens` 计入输出。

注意：

- 状态行显示「本月已用 $X」，不是余额；报表数据比实时用量滞后约 5 分钟。
- 报表按 `bucket_width=1d` 分桶，插件把 `data[].results` 展平求和（也兼容顶层 `results`）。
- 凭证缺失返回 `missing-credential`，客户端显示「未配置 Admin Key」。

## OpenAI（本月已用）

OpenAI 同样没有余额接口，插件读取 Organization Costs API，显示当前 UTC 自然月已产生费用。需要 **Admin API Key**（`sk-admin…`，platform.openai.com → Admin keys 创建，仅组织 Owner 可建），Responses / Chat 用的推理 Key 不能查询；凭证引用默认 `OPENAI_ADMIN_KEY`，兼容 `OPENAI_ADMIN_API_KEY`：

```http
GET https://api.openai.com/v1/organization/costs?start_time=<月初 Unix 秒>&end_time=<次月 Unix 秒>&bucket_width=1d
Authorization: Bearer <Admin Key>
```

返回（字段有裁剪）：

```json
{
  "object": "page",
  "results": [
    { "amount": { "value": 12.34, "currency": "usd" } }
  ],
  "has_more": false,
  "next_page": null
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `results[].amount.value` | 该行费用（USD 小数），全部行求和作为「本月已用」 |
| `has_more` / `next_page` | 分页游标；插件跟随 `next_page` 继续请求，最多 5 页 |

插件会附带请求用量接口补充统计（失败只丢弃附加信息）：

```http
GET https://api.openai.com/v1/organization/usage/completions?start_time=<月初 Unix 秒>&end_time=<次月 Unix 秒>&bucket_width=1d
```

其 `results` 行的 `input_tokens` / `output_tokens` / `num_model_requests` 累加为输入 / 输出 Tokens 与请求数。

注意：

- 状态行显示「本月已用 $X」；成本数据比实时用量略有滞后。
- 凭证缺失返回 `missing-credential`，客户端显示「未配置 Admin Key」。

## Cloudflare Workers AI / AI Gateway（余额 + 本期已用）

Cloudflare 的计费在账户侧，插件读取 AI Gateway 的计费接口，需要**账户级 API Token**（带 AI Gateway Read 与 Billing Read 权限）加 `CLOUDFLARE_ACCOUNT_ID`——与推理用的 Workers AI / AI Gateway Token 是两份互不替代的凭证，推理 Token 读不到账单。凭证引用默认 `CLOUDFLARE_API_TOKEN`，兼容 `CLOUDFLARE_API_KEY`；账户 ID 固定读 `CLOUDFLARE_ACCOUNT_ID`。主机 `api.cloudflare.com` / `gateway.ai.cloudflare.com` / `*.workers.dev` 都映射到 `https://api.cloudflare.com/client/v4`：

```http
GET https://api.cloudflare.com/client/v4/accounts/<account_id>/ai-gateway/billing/credit-balance
Authorization: Bearer <账户级 API Token>
```

```http
GET https://api.cloudflare.com/client/v4/accounts/<account_id>/ai-gateway/billing/usage-history?value_grouping_window=day&start_time=<月初毫秒>&end_time=<次月毫秒>
Authorization: Bearer <账户级 API Token>
```

返回（字段有裁剪）：

```json
{ "success": true, "errors": [], "result": { "balance": 95.5, "has_default_payment_method": true } }
```

```json
{ "success": true, "errors": [], "result": { "history": [ { "aggregated_value": 3.21 } ] } }
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `result.balance` | 剩余预付 Credit（USD），状态行「余额 $X」 |
| `result.has_default_payment_method` | 是否绑定默认支付方式 |
| `result.history[].aggregated_value` | 日用量金额，按天求和得「本期已用」 |

注意：

- 两个接口**单侧失败可容忍**：只剩余额或只剩本月已用也照常显示（状态行优先显示余额，退回「本月已用」）；两侧都失败才按临时失败处理。
- 响应必须是标准 `{ success, errors, result }` 信封，`success: false` 或缺 `result` 按临时失败处理。
- 任一凭证缺失返回 `missing-credential`，客户端显示「未配置 Cloudflare API Token 或 Account ID」。

## OpenAI Codex（5h / 周订阅额度）

OpenAI Codex（legacy）读取的是 ChatGPT 订阅的 5 小时 / 周窗口额度，不是 API Key 账单。插件请求 ChatGPT 后端用量接口 `GET https://chatgpt.com/backend-api/wham/usage`；`chatgpt.com` 不能按主机自动映射，插件按 URL 路径识别（`chatgpt.com` 且路径含 `/backend-api`），也可在 `config.providers` 显式声明。凭证是 ChatGPT OAuth access token（如 Codex CLI 登录后的凭证），引用默认 `OPENAI_CODEX_TOKEN`，兼容 `OPENAI_CODEX_OAUTH_TOKEN` / `CHATGPT_OAUTH_TOKEN`；另需账户 ID（`ChatGPT-Account-Id` 头），引用 `OPENAI_CODEX_ACCOUNT_ID`，兼容 `CHATGPT_ACCOUNT_ID`，**两件缺一不可**：

```http
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <ChatGPT OAuth access token>
ChatGPT-Account-Id: <account_id>
```

返回（字段有裁剪）：

```json
{
  "plan_type": "plus",
  "rate_limit": {
    "primary_window": { "used_percent": 20, "reset_at": 1793019108 },
    "secondary_window": { "used_percent": 40, "reset_after_seconds": 3600 }
  },
  "rate_limit_reset_credits": { "available_count": 2 },
  "additional_rate_limits": [ { "label": "o3", "used_percent": 10 } ]
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `rate_limit.primary_window` | 5 小时窗口 |
| `rate_limit.secondary_window` | 周窗口 |
| `used_percent` | **已用**百分比，剩余 = `100 - used_percent` |
| `reset_at` / `reset_after_seconds` | 重置时间：绝对时间戳优先，缺省用 `now + reset_after_seconds` 推算 |
| `plan_type` | 套餐类型（`plus` / `pro` / `team` 等），作为附加信息返回 |
| `rate_limit_reset_credits.available_count` | 可用重置券数量，附加信息 |
| `additional_rate_limits[]` | 附加窗口（如特定模型），附加信息 |

注意：

- 这是从 openai/codex 源码逆向出来的**非公开内部接口**，不是公开承诺，字段与可用性可能随时变化，需要容错。
- 状态行显示「5h 剩 X% · 周 剩 Y%」；5 小时窗口缺失按临时失败处理，周窗口可选。
- 凭证缺失返回 `missing-credential`，客户端显示「未配置 ChatGPT OAuth Token」。

## 自定义或增加 provider

### 显式覆盖

未知代理不会从推理 `baseURL` 自动猜测额度地址。在插件行的 `config.providers` 中显式声明完整适配器，不需要改代码：

```yaml
- id: llm-quota
  name: '@cs-qyzhang/dsh-llm-quota'
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

`kind` 必须是已有适配器：`account`、`anthropic`、`baseten`、`cloudflare`、`deepseek`、`fireworks`、`github-copilot`、`glm`、`huggingface`、`kimi`、`minimax`、`moonshot`、`openai`、`openai-codex`、`opencode-go`、`openrouter`、`qwen`、`radius`、`together`、`vercel-gateway`、`xai`、`xiaomi-mimo`。

- 某个 provider 的显式配置会整体替代自动解析结果，因此自定义 GLM / Kimi / MiniMax / Moonshot / OpenRouter / Vercel AI Gateway 应同时提供 `endpoint` 和 `keyNames`。
- `xiaomi-mimo` 的 `endpoint` 是控制台 API 基地址（默认 `https://platform.xiaomimimo.com/api/v1`），`keyNames` 填控制台 Cookie 的凭据引用，`mode` 可选 `balance` 或 `plan`。
- `qwen` 的 `endpoint` 是控制台 `cli/api.json` 完整地址，`keyNames` 默认取 `QWEN_CONSOLE_TOKEN` / `BAILIAN_CONSOLE_TOKEN`。
- `xai` 的 `endpoint` 是 Management API 基地址（默认 `https://management-api.x.ai`），`keyNames` 默认取 `XAI_MANAGEMENT_KEY` / `XAI_MANAGEMENT_API_KEY`。
- `fireworks` 的 `endpoint` 是 Gateway API 基地址（默认 `https://api.fireworks.ai/v1`），适配器在其后补全账号与账单路径。
- `anthropic` 的 `endpoint` 是成本报表完整地址（默认 `https://api.anthropic.com/v1/organizations/cost_report`），`keyNames` 填 Admin Key 的凭据引用；`openai` 同理（默认 `https://api.openai.com/v1/organization/costs`，`keyNames` 填 `sk-admin…` 的凭据引用）。
- `github-copilot` 的 `endpoint` 是 `https://api.github.com/copilot_internal/user`，`keyNames` 填 GitHub Token 的凭据引用。
- `radius` 的 `endpoint` 是网关基地址（默认 `https://radius.pi.dev`）；`huggingface` 的 `endpoint` 是 `usage-v2` 接口完整地址；`opencode-go` 的 `endpoint` 是 `https://opencode.ai/zen/go/v1/usage`，三者 `keyNames` 均可填推理 Key 的凭据引用。
- `openai-codex` 除 `keyNames`（ChatGPT OAuth Token 的凭据引用）外还固定读取 `OPENAI_CODEX_ACCOUNT_ID` / `CHATGPT_ACCOUNT_ID` 作为账户 ID，两者缺一不可。
- `cloudflare` 的 `endpoint` 是 API 基地址（默认 `https://api.cloudflare.com/client/v4`），`keyNames` 填账户级 API Token 的凭据引用；账户 ID 同样固定读取 `CLOUDFLARE_ACCOUNT_ID`。
- 显式覆盖不要求 DSH 中存在同名激活路由。

### 接入新的额度体系

供应商兼容代码集中在 `providers/` 目录：

| 文件 | 职责 |
| --- | --- |
| `providers/index.js` | 适配器注册表：主机 → 端点映射、按 `kind` 分发 `readQuota` |
| `providers/resolve.js` | 从 DSH 实时配置解析 provider 的凭证引用与 `baseURL` |
| `providers/shared.js` | 凭证读取、上游 HTTP、缓存指纹与统一响应片段 |
| `providers/<kind>.js` | 单个额度体系的解析逻辑 |

接入步骤：

1. 在 `providers/` 新建适配器模块，导出 `kind`、`hosts`（已知 HTTPS 主机 → 固定额度端点，没有则用空对象）和 `read(ctx, route)`；需要按 URL 路径或主机族匹配时再导出 `routeFor(baseURL)`（如 `opencode-go`、`openai-codex`、`cloudflare`）。
2. 在 `providers/index.js` 的 `ADAPTERS` 数组注册该模块。
3. 如果新供应商的凭证引用或 `baseURL` 来自新的 DSH 插件，或需要 `routeFor` 路由，在 `providers/resolve.js` 增加一个分支。
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

5. 如果新类型需要不同的状态行文案，在 `client.js` 的 `compactLabel` / `panelTitle` 中增加分支和 `zh` / `en` 字典键。
6. 更新根目录 README 的支持范围表与本文档。

## 接口稳定性

- DeepSeek 账号余额走 dsh 内部服务，稳定性由 dsh 版本决定。
- DeepSeek API Key 余额是官方公开接口。
- Z.AI / 智谱 与 Kimi 的额度接口不是公开文档 API，属于其前端或 CLI 正在使用的接口；字段或路径变化时，只需调整对应适配器。
- GLM / Kimi 只返回一个有效额度窗口是合法情况；完全无法识别的响应按临时失败处理，不会覆盖旧成功数据。
- Qwen 控制台接口与 Xiaomi MiMo 控制台接口都不是公开 API，字段可能变化，且需要控制台凭证。
- Baseten / Fireworks AI / Together AI 只报告已用金额，没有余额或套餐百分比；Together 的用量接口是 beta、按组织开通。Hugging Face 的 `usage-v2` 响应 schema 未写进 Hub OpenAPI，适配器按兄弟接口的行结构兼容解析。
- xAI 账单走 Management API，需要控制台创建的 Management Key（与推理 Key 不同），金额字段是 USD 美分且预付余额以负数表示。
- Anthropic / OpenAI 的用量走 Admin API（成本 / 用量报表），需要 Admin Key（`sk-ant-admin…` / `sk-admin…`），报表数据比实时用量略有滞后，Anthropic 的 `amount` 是 USD 美分。
- GitHub Copilot 的 `copilot_internal/user` 与 OpenAI Codex 的 `chatgpt.com/backend-api/wham/usage` 都是非公开内部接口（后者从 openai/codex 源码逆向），字段或可用性可能随时变化，需按临时失败容错。
- Radius 的组织 / 账单接口与 Cloudflare 的 AI Gateway 计费接口需要各自的专用凭证（组织级 API Key、账户级 API Token + Account ID），与推理凭证分开管理。
- Loader 实时配置读取与 manifest 兼容声明当前针对 DSH `0.2.1-rc.2` 与 `0.2.1-rc.3`，升级后需重新核对配置结构。
