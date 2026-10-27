# dsh 三方模型 Provider 与插件支持清单

本文回答两个问题：

1. dsh（DeepSeek Harness）本身支持哪些三方模型 Provider；
2. dsh-llm-quota 当前对它们的支持 / 不支持情况。

清单核对自本机安装的 dsh 0.2.1-rc.2 内置目录：pi-ai 提供方目录（`@earendil-works/pi-ai` 的 `providers/`）、`dsh-llm-pi-ai` 的 `PROVIDER_DATA`（端点与凭证引用），以及 `dsh-llm-deepseek` 的 DeepSeek 直连路由。pi-ai 升级新增提供方后，本表需要同步维护。

## dsh 的 Provider 从哪来

| 路由来源 | 插件 | 说明 |
| --- | --- | --- |
| pi-ai 目录 | `@deepseek-ai/dsh-llm-pi-ai` | 全部内置三方 Provider，provider id 即路由名；只有聊天模型的提供方才进入目录（如 `typesafe` 仅有分类器模型，不注册） |
| DeepSeek 直连 | `@deepseek-ai/dsh-llm-deepseek` | `deepseek-official` 路由 |
| DeepSeek 账号 | `@deepseek-ai/dsh-llm-deepseek-account` | `deepseek-account` 路由（账号登录，非 API Key） |
| 手写网关 | `llm-pi-ai.config.providers` | 用户自定义路由，端点与协议自行声明 |

插件按「当前会话所选模型的 provider id」解析额度路由，不按名称猜测供应商，规则见 [providers.md](providers.md#自动解析)。

## 一、插件已支持的 Provider（显示额度）

| Provider | provider id | 默认推理地址 | 凭证引用 | 额度适配器 | 状态行显示 |
| --- | --- | --- | --- | --- | --- |
| DeepSeek 账号 | `deepseek-account` | 账号登录 | DSH 账号登录 | `account` | 余额 |
| DeepSeek | `deepseek-official`、`deepseek` | `api.deepseek.com` | `DEEPSEEK_API_KEY` | `deepseek` | 余额 |
| Z.AI / 智谱 GLM | `zai`、`zai-coding-cn` | `api.z.ai` / `open.bigmodel.cn` | `ZAI_API_KEY` / `ZAI_CODING_CN_API_KEY` | `glm` | 5h / 周套餐 |
| Kimi For Coding | `kimi-coding` | `api.kimi.com` | `KIMI_API_KEY` | `kimi` | 5h / 周套餐 |
| MiniMax | `minimax`、`minimax-cn` | `api.minimax.io` / `api.minimaxi.com` | `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY` | `minimax` | 5h / 周套餐 |
| Moonshot 开放平台 | `moonshotai`、`moonshotai-cn` | `api.moonshot.ai` / `api.moonshot.cn` | `MOONSHOT_API_KEY` | `moonshot` | 余额 |
| OpenRouter | `openrouter` | `openrouter.ai` | `OPENROUTER_API_KEY` | `openrouter` | 余额 |
| Radius | `radius` | `radius.pi.dev` | `RADIUS_API_KEY` | `radius` | 余额 |
| Vercel AI Gateway | `vercel-ai-gateway` | `ai-gateway.vercel.sh` | `AI_GATEWAY_API_KEY` | `vercel-gateway` | 余额 |
| Baseten | `baseten` | `inference.baseten.co` | `BASETEN_API_KEY` | `baseten` | 本月已用 |
| Fireworks AI | `fireworks` | `api.fireworks.ai` | `FIREWORKS_API_KEY` | `fireworks` | 本月已用 |
| Hugging Face | `huggingface` | `router.huggingface.co` | `HF_TOKEN` / `HUGGINGFACE_TOKEN` | `huggingface` | 本月已用 |
| Together AI | `together` | `api.together.ai` | `TOGETHER_API_KEY` | `together` | 本月已用 |
| Anthropic | `anthropic` | `api.anthropic.com` | `ANTHROPIC_ADMIN_KEY`（Admin Key，非推理 Key） | `anthropic` | 本月已用 |
| OpenAI | `openai` | `api.openai.com` | `OPENAI_ADMIN_KEY`（Admin Key，非推理 Key） | `openai` | 本月已用 |
| xAI | `xai` | `api.x.ai` | `XAI_MANAGEMENT_KEY`（Management Key，非推理 Key） | `xai` | 余额 |
| 阿里云百炼 Qwen Token Plan | `qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual` | `token-plan.*.maas.aliyuncs.com` | `QWEN_TOKEN_PLAN_*_API_KEY` + 控制台 `QWEN_CONSOLE_TOKEN` | `qwen` | 套餐 |
| Xiaomi MiMo（按量） | `xiaomi` | `api.xiaomimimo.com` | `XIAOMI_API_KEY` + 控制台 `MIMO_COOKIE` | `xiaomi-mimo`（balance） | 余额 |
| Xiaomi MiMo（Token Plan） | `xiaomi-token-plan-cn`、`xiaomi-token-plan-sgp`、`xiaomi-token-plan-ams` | `token-plan-*.xiaomimimo.com` | `XIAOMI_TOKEN_PLAN_*_API_KEY` + 控制台 `MIMO_COOKIE` | `xiaomi-mimo`（plan） | 套餐 |
| GitHub Copilot | `github-copilot` | `api.*.githubcopilot.com` | `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN` | `github-copilot` | 套餐 |
| OpenAI Codex（legacy） | `openai-codex` | `chatgpt.com/backend-api` | `OPENAI_CODEX_TOKEN` + `OPENAI_CODEX_ACCOUNT_ID` | `openai-codex` | 5h / 周套餐 |
| OpenCode Go | `opencode-go` | `opencode.ai/zen/go` | `OPENCODE_GO_API_KEY` | `opencode-go` | 5h / 周套餐 |
| Cloudflare Workers AI / AI Gateway | `cloudflare-workers-ai`、`cloudflare-ai-gateway` | `*.workers.dev` / `gateway.ai.cloudflare.com` | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（账户级，非推理 Token） | `cloudflare` | 余额 / 本月已用 |

补充说明：

- `deepseek` 是 pi-ai 目录路由，`deepseek-official` 是 DeepSeek 直连路由，两者都落在 `api.deepseek.com`，共用同一个余额适配器。
- 上表按「推理主机命中已知映射」生效：把 `baseURL` 显式改成其它已知主机时，插件跟随修改后的主机（例如 `zai` 改指 `open.bigmodel.cn` 会走 GLM 国内配额接口）。少数路由靠 URL 路径区分：`opencode-go` 只认 `opencode.ai` 下的 `/zen/go` 路径，`openai-codex` 只认 `chatgpt.com` 下含 `/backend-api` 的路径。
- Qwen 与 Xiaomi MiMo 的推理 Key 不能查询额度，分别需要控制台 token 与控制台 Cookie，配置方式见 [providers.md](providers.md#阿里云百炼-qwen-token-plan) 与 [providers.md](providers.md#xiaomi-mimo-开放平台按量余额--token-plan)。
- Baseten、Fireworks AI、Together AI、Hugging Face 官方没有余额接口，状态行显示的是**当月已用金额**，不是余额或套餐百分比；Hugging Face 无金额数据时降级显示本月请求数。
- Anthropic 与 OpenAI 同样没有余额接口，状态行显示**本月已用**，且必须使用 Console 创建的 **Admin Key**（`sk-ant-admin…` / `sk-admin…`，OpenAI 仅组织 Owner），普通推理 Key 查询不到用量。
- xAI 的推理 Key 不能查询账单，需要 console.x.ai 创建的 Management Key，配置方式见 [providers.md](providers.md#xai预付余额)。
- Cloudflare 的额度查询用的是账户级 API Token（AI Gateway Read / Billing Read 权限）加 `CLOUDFLARE_ACCOUNT_ID`，与推理用的 Workers AI / AI Gateway Token 是两份互不替代的凭证。
- Radius 是 Pi / Earendil AI 网关，`RADIUS_API_KEY` 为组织级网关凭证，状态行显示余额，展开面板显示本期已用。
- GitHub Copilot 与 OpenAI Codex 读取的是 VS Code Copilot 扩展 / ChatGPT 后端正在使用的**非官方内部接口**，字段与可用性可能变动，请求失败按临时失败处理，需要容错。
- 各厂商接口、请求与响应字段详见 [providers.md](providers.md#支持的额度体系)。

## 二、插件暂不支持的 Provider（不显示额度）

不支持时不会报错：状态行不渲染额度条目，Host 的 `/api/llm-quota` 返回 `unsupported`，也不会把凭证发给任何上游。

### 按量计费 API Key 型（官方无可查询的余额 / 用量接口）

以下厂商经核对（官方文档 / 官方 SDK / 端点探测）确认：用推理 API Key 无法查询余额或用量，账单与限额只在网页控制台，因此无法接入额度适配器。

| Provider | provider id | 默认推理地址 | 凭证引用 | 不支持原因 |
| --- | --- | --- | --- | --- |
| Ant Ling（蚂蚁百灵） | `ant-ling` | `api.ant-ling.com` | `ANT_LING_API_KEY` | 未核实到公开的余额 / 用量接口 |
| Cerebras | `cerebras` | `api.cerebras.ai` | `CEREBRAS_API_KEY` | 官方无余额 / 用量接口，用量与限额在 Cloud Console |
| Google Gemini | `google` | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` | 官方无额度接口，限额在 AI Studio 网页；Cloud Quotas API 需 OAuth |
| Groq | `groq` | `api.groq.com` | `GROQ_API_KEY` | 官方无余额 / 用量接口，Spend Limits 在控制台网页 |
| Mistral | `mistral` | `api.mistral.ai` | `MISTRAL_API_KEY` | 官方无余额 / 用量接口，用量在 Console 网页 |
| NVIDIA | `nvidia` | `integrate.api.nvidia.com` | `NVIDIA_API_KEY` | 官方无余额 / 用量接口，速率限额在 build.nvidia.com 网页 |

以上若官方日后开放余额 / 用量接口，按 [providers.md](providers.md#接入新的额度体系) 新增一个 `providers/<kind>.js` 适配器并在注册表登记即可。

### 无公开余额接口 / 用量在控制台

| Provider | provider id | 默认推理地址 | 凭证引用 | 不支持原因 |
| --- | --- | --- | --- | --- |
| Meta | `meta` | `api.meta.ai` | `META_API_KEY`（也支持 Muse 订阅 OAuth） | 未接入；订阅额度不在推理 Key 上 |

### 订阅 / OAuth 登录型

GitHub Copilot、OpenAI Codex（legacy）、OpenCode Go、Radius 已移到上表：Copilot 用 GitHub Token、Codex 用显式配置的 ChatGPT OAuth Token + Account ID 读取订阅额度，OpenCode Go 用 `OPENCODE_GO_API_KEY` 读取 `opencode.ai/zen/go/v1/usage`，Radius 用组织级 `RADIUS_API_KEY` 读取余额。

Kimi、OpenRouter 等虽然也支持 OAuth 订阅登录，但它们同时提供推理 Key：配好 `apiKeyEnv` 后，Kimi / OpenRouter 仍可正常显示额度（见上表）。xAI 的订阅额度不在推理 Key 上，插件改用控制台 Management Key 读取账单（见上表）。

### 云托管 / 企业计费型

| Provider | provider id | 端点 | 凭证引用 | 不支持原因 |
| --- | --- | --- | --- | --- |
| Amazon Bedrock | `amazon-bedrock` | 由 `AWS_REGION` 等决定 | AWS 凭证族（profile / IAM / bearer） | 计费在 AWS 账户侧，推理凭证无余额查询接口 |
| Azure OpenAI | `azure` | 由 `AZURE_OPENAI_*` 决定 | `AZURE_OPENAI_API_KEY` | 计费在 Azure 订阅侧 |
| Google Vertex AI | `google-vertex` | 由项目 / 区域决定 | ADC / `GOOGLE_CLOUD_API_KEY` | 计费在 GCP 项目侧 |

### 其它

| Provider | provider id | 不支持原因 |
| --- | --- | --- |
| OpenCode Zen | `opencode` | 无固定默认推理端点，无法按主机映射 |
| TypeSafe | `typesafe` | 仅分类器模型，不进入 dsh 聊天路由目录 |
| 手写网关 / 代理路由 | 用户自定义 | 主机不在已知映射中；需在 `config.providers` 显式声明额度端点与凭证引用 |

## 三、手写路由与显式覆盖

- 手写网关路由（`llm-pi-ai.config.providers`）只要 `baseURL` 的主机命中已知映射（如自建代理转发到 `api.kimi.com`），插件同样能显示额度。
- 主机未知的代理不会被猜测额度地址；在插件行的 `config.providers` 里显式声明 `kind`、`endpoint`、`keyNames` 即可复用现有适配器，无需改代码，见 [providers.md](providers.md#自定义或增加-provider)。
- OAuth-only 路由不再一概返回 `unsupported`：`openai-codex`（`chatgpt.com` 的 `/backend-api` 路径）可通过显式配置的 ChatGPT OAuth Token + Account ID 显示额度，`github-copilot` 也可用显式配置的 GitHub Token 查询；其余 OAuth-only 路由、未激活的 provider、自托管地址仍默认返回 `unsupported`。

## 四、想让某个供应商显示额度

1. 先确认 dsh 中该 provider 的路由 id 与 `baseURL` 主机（模型选择器里的 provider id 即路由名）。
2. 若主机已命中本文第一节的映射，只差凭证配置。
3. 否则按 [providers.md](providers.md#接入新的额度体系) 新增适配器：`providers/<kind>.js` + 注册表登记 + 必要时在 `providers/resolve.js` 增加解析分支，并同步更新本文与根目录 README 的支持范围表。
