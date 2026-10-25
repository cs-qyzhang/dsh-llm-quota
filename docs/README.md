# dsh-llm-quota

在 DeepSeek Harness（dsh）Web 界面的输入框下方状态行里，显示当前模型供应商的剩余金额或 Coding Plan 额度。

状态行就是现有的「1 轮 1 步 · tok/s」「缓存命中」那一行。插件以 `order: 2` 注册到 `conversation.composer.dock`，排在「缓存命中」和上下文百分比之间。

## 显示内容

| 当前供应商 | 状态行 | 点击展开 |
| --- | --- | --- |
| DeepSeek（账号 / 按量计费） | `余额 ¥65.28` | 充值余额、赠送余额、更新时间 |
| GLM Coding Plan（Z.AI / 智谱） | `5h 剩 100% · 周 剩 33%` | 套餐等级、5 小时与周额度、重置时间 |
| Kimi For Coding | `5h 剩 0% · 周 剩 33%` | 5 小时与周额度、重置时间 |
| Moonshot 开放平台（按量） | `余额 ¥49.59` | 现金余额、代金券余额、更新时间 |
| 阿里云百炼 Qwen Token Plan | `套餐剩 50%` | 月度额度、重置时间 |
| Xiaomi MiMo（按量计费） | `余额 ¥65.28` | 现金/赠送余额、更新时间 |
| Xiaomi MiMo（Token Plan） | `套餐剩 73%` | 套餐与本月用量、重置时间 |
| 其它供应商 | 不显示 | — |

- 额度跟随当前会话的模型选择自动切换。
- 模型选择菜单里每个 provider 分组标题右侧，以及输入区「当前模型」标签内，也会显示同一份额度的紧凑版本（如 `5h 100% · 周 33%`、`¥1017.00`）；新会话欢迎页没有状态行时同样可见。
- 取不到额度（未配置 Key、未登录、接口失败）时，菜单与当前模型处不显示任何内容，不影响模型选择。
- Host 每次请求都读取 DSH 当前激活 provider 的实时配置，自动跟随 `apiKeyEnv`、原生环境凭证和 `baseURL`。
- 客户端每 60 秒刷新一次；Host 按 provider、额度端点和凭证引用缓存成功结果 30 秒，单次额度读取最长 5 秒。
- 临时接口失败时保留上一次成功的数据，并在展开面板里标记「数据可能已过期」；未配置凭证或退出登录等终态会立即替换旧数据。

## 目录结构

```text
dsh-llm-quota/
├── package.json          # bundle 清单、dsh.client 配置、导出项
├── cordis.patch.yml      # 向 profile 插入 llm-quota 插件行
├── index.js              # Host 侧：额度路由、缓存、错误处理
├── providers/            # 供应商兼容层
│   ├── index.js          # 适配器注册表：主机映射、按 kind 分发
│   ├── resolve.js        # DSH 实时配置 → 额度路由
│   ├── shared.js         # 凭证读取、上游 HTTP、响应工具
│   ├── account.js        # DeepSeek 账号余额
│   ├── deepseek.js
│   ├── glm.js
│   ├── kimi.js
│   ├── minimax.js
│   ├── moonshot.js
│   ├── openrouter.js
│   ├── qwen.js
│   └── xiaomi-mimo.js
├── client.js             # Client 侧：状态行条目、轮询、展开浮层
├── locale/
│   ├── en.json           # 插件管理页显示用元数据
│   └── zh.json
└── icon.svg              # 插件图标
```

更细的实现说明见 [architecture.md](./architecture.md)，供应商接口与扩展方式见 [providers.md](./providers.md)。

## 安装

插件以 bundle 形式安装到 dsh 的 `web` profile。安装需要两步：把包加入 profile 依赖，并把 bundle 名加入 `dsh.profile.bundles`。

### 前置条件

`dsh plugin` 会调用 `pnpm`。如果 `pnpm` 不在 PATH 中，可以先安装 pnpm，或者用 `npx` 代替：

```bash
cd "$DSH_HOME/profiles/web"
npx -y pnpm@10 add /path/to/dsh-llm-quota
```

### 写入 profile

编辑 `$DSH_HOME/profiles/web/package.json`：

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "@local/dsh-llm-quota": "link:/path/to/dsh-llm-quota"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@local/dsh-llm-quota"
      ]
    }
  }
}
```

`dependencies` 负责让 Node 能解析到包，`dsh.profile.bundles` 负责让 loader 应用 `cordis.patch.yml`。只做其中一步插件不会生效。

如果使用 Web 的 Plugins 页或 dsh 的 `plugin_manager.install_bundle`，这两步会由安装器自动完成。

### 验证

```bash
# 1. 语法与 Host 回归测试（不访问真实供应商）
npm run check
npm test

# 2. 确认插件行进入了组合后的配置
dsh --profile web --dump-config | grep -A 3 llm-quota

# 3. 启动
dsh web --port 3090 --no-open

# 4. 未认证请求应返回 401，而不是额度 JSON
curl -i 'http://127.0.0.1:3090/api/llm-quota?provider=kimi-coding'
```

然后通过启动时打印的认证 URL 打开浏览器，进入已有会话并确认输入框下方出现额度条目。

### 卸载

1. 从 `dsh.profile.bundles` 中移除 `@local/dsh-llm-quota`。
2. 从 profile 中移除依赖：

```bash
cd "$DSH_HOME/profiles/web"
npx -y pnpm@10 remove @local/dsh-llm-quota
```

3. 重启 dsh，或重载页面。

## 配置

默认情况下，插件通过 DSH 的 provider directory 和 Loader 实时配置确定凭证引用与推理主机，再映射到固定的额度端点。只有 `api.deepseek.com`、`api.z.ai`、`open.bigmodel.cn`、`api.kimi.com`、`api.moonshot.cn`、`api.moonshot.ai`、`token-plan.*.maas.aliyuncs.com` 和 `*.xiaomimimo.com` 会自动适配；OAuth-only 和未知代理主机不会收到凭证。自定义代理需要显式配置额度端点。

Xiaomi MiMo 需要两份凭证：推理 Key 放在 `XIAOMI_API_KEY`（模型路由使用），额度 Cookie 放在 `MIMO_COOKIE`。插件按 provider 类型读取对应数据：`xiaomi`（`api.xiaomimimo.com`）只显示按量余额，`xiaomi-token-plan-*`（`token-plan-*.xiaomimimo.com`）只显示 Token Plan 额度。Cookie 获取方式：登录 `platform.xiaomimimo.com`，从任意 `/api/v1/` 请求复制完整的 `Cookie` 请求头，至少包含 `serviceToken` 与 `userId`，然后写入 `$DSH_HOME/.credentials.yaml` 的 `refs` 段：

```yaml
refs:
  XIAOMI_API_KEY: sk-...
  MIMO_COOKIE: "serviceToken=...; userId=..."
```

只追加这一行，保留已有的 `records` 与其他 refs 不动；也可以改用环境变量 `MIMO_COOKIE`。Cookie 过期后重新复制。完整步骤见 [providers.md](./providers.md#xiaomi-mimo-开放平台按量余额--token-plan)。

Moonshot 开放平台（`moonshotai` / `moonshotai-cn`）直接使用推理 Key 读取 `/v1/users/me/balance`，不需要额外配置。Qwen Token Plan 的 `sk-sp-*` 推理 Key 不能查询套餐额度，需要额外提供控制台 access token（凭据名 `QWEN_CONSOLE_TOKEN`），获取方式见 [providers.md](./providers.md#阿里云百炼-qwen-token-plan)。

插件行支持可选的 `config`：

```yaml
- id: llm-quota
  name: '@local/dsh-llm-quota'
  config:
    cacheSeconds: 30
    providers:
      my-glm-route:
        kind: glm
        endpoint: https://api.z.ai/api/monitor/usage/quota/limit
        keyNames: [MY_GLM_API_KEY]
      my-kimi-route:
        kind: kimi
        endpoint: https://api.kimi.com/coding/v1/usages
        keyNames: [MY_KIMI_KEY]
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `cacheSeconds` | `30` | Host 侧每个配置指纹的成功结果缓存秒数 |
| `providers` | 自动解析 | 整体覆盖指定 provider 的适配器配置 |

`providers` 的值会整体替换该 provider 的自动解析结果；`kind` 决定适配器，支持 `account`、`deepseek`、`glm`、`kimi`、`xiaomi-mimo`。自定义 GLM/Kimi 代理应同时显式填写 `endpoint` 和 `keyNames`；`xiaomi-mimo` 的 `endpoint` 是控制台 API 基地址，`keyNames` 是 Cookie 凭据引用。

## 安全

- API Key 只在 Host 进程内读取和使用，浏览器拿不到密钥。
- `/api/llm-quota` 通过 DSH `connection.fetch` 注册，请求先经过 Connection 的 Host/Origin 检查和登录认证，不再依赖裸回环路由。
- 路由只返回额度数字与错误原因，不返回凭证；缓存键也只包含 provider、固定额度端点和凭证引用名，不包含凭证值。
- 自动解析只接受已知 HTTPS 主机。未知代理、自托管地址和 OAuth-only 路由不会被自动发送凭证。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 状态行没有额度条目 | 是否在已打开的会话中；当前 provider 是否属于支持的供应商；新会话欢迎页不渲染 dock，改看模型菜单或当前模型标签 |
| 模型菜单/当前模型旁没有额度 | 当前 provider 是否属于支持的供应商；刷新页面；DSH 升级后确认 `data-provider-id` / `data-menu-group` 钩子仍在 |
| 显示 `额度暂不可用` | `curl` 对应 provider 的路由，查看 `reason` / `error` |
| 显示 `未配置 API Key` | 对应的凭证名是否在 dsh 凭证库或启动环境中 |
| 显示 `未配置 MiMo 控制台 Cookie` | 是否已配置 `MIMO_COOKIE`；Cookie 是否包含 `serviceToken` 与 `userId`；Cookie 是否过期 |
| 显示 `请先登录 DeepSeek` | DeepSeek 账号登录状态 |
| `slot entry crashed in 'conversation.composer.dock'` | 打开浏览器控制台，检查 Client 插件异常；改完 `client.js` 后需要刷新页面 |
| 改了代码但页面没变化 | 客户端模块按文件 mtime/size 生成 revision；刷新页面，必要时重启 dsh |

## 已知限制

- 状态行只在对话内容中使用；欢迎页/无 Session 时改用模型选择菜单与当前模型标签查看额度。
- 模型菜单与当前模型的额度通过 DSH 的 `data-provider-id` / `data-menu-group` DOM 钩子做 CSS 装饰，不占用 `conversation.input.model.label`（该 single slot 已由内置 `1017` 徽标插件占用）。DSH 升级后需复核这些钩子。
- `/model` 斜杠命令弹窗的模型行不含 provider 标识，暂不显示额度。
- Z.AI 与 Kimi 的额度接口不是公开文档 API，属于前端或 CLI 正在使用的接口，字段可能变化。
- GLM 当前账户可能只返回 5 小时额度，不返回周额度；界面按实际返回条目渲染。
- Kimi 新套餐可能没有周额度；同样按返回条目渲染。
- Xiaomi MiMo 的余额与套餐额度使用控制台 Cookie，不是推理 API Key；Cookie 会过期，需要定期更换。
- Moonshot 开放平台、OAuth-only 路由和未知代理端点暂不自动适配；自定义代理可显式覆盖。
- 当前实时配置读取与兼容声明针对 DSH `0.2.1-rc.2`，升级 DSH 后需要重新验证。
- 只实现了余额/额度展示，没有充值、切换套餐或告警能力。
