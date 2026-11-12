# 文档

本目录保存 dsh-llm-quota 的内部实现与供应商接口说明。安装、使用和日常配置请先阅读根目录的 [README](../README.md)。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | Host / Client 如何协作、状态行与模型标签的渲染位置、缓存与超时、浮层、本地验证 |
| [providers.md](providers.md) | 支持的供应商、请求与响应格式、自定义 provider、接入新额度体系 |
| [dsh-providers.md](dsh-providers.md) | dsh 全部三方模型 Provider，插件支持与不支持的清单及原因 |

## 阅读顺序

1. 想安装或使用插件：先看 [README](../README.md)。
2. 想改渲染、缓存或 Host 路由：看 [architecture.md](architecture.md)。
3. 想接新供应商或排查额度字段：看 [providers.md](providers.md)。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| bundle / profile | 插件以 bundle 形式发布；profile 的 `dependencies` 与 `dsh.profile.bundles` 缺一不可 |
| Host / Client | Host 负责凭证、上游请求、缓存和 ViewModel；Client 只负责通用渲染、交互与轮询，不执行 Provider 的浏览器代码 |
| Provider / registry | Provider 在单个模块中声明路由、读取、展示和历史指标；registry 统一管理内置 Provider 与 `providerModules` 加载的外部 Provider |
| provider id | DSH 模型路由名，例如 `zai-coding-cn`、`kimi-coding`、`deepseek-account` |
| 注册 `kind` | Provider 的唯一身份，例如 `glm`、`kimi`、`xiaomi-mimo`；响应数据的 `kind` 可覆盖为 `balance` 等兼容形状 |
| `viewId` / `view` | `viewId` 始终是注册 `kind`，用于选择 manifest 中的展示声明；`view` 是 Host `present()` 生成的纯数据动态覆盖 |
| views manifest | `/api/llm-quota/views` 返回的 `views`、`messages`、`credentials`、`history`、`historyPriority`，不包含函数或秘密值 |
| quota route | 由实时配置解析出的 `{ provider, kind, endpoint, keyNames, mode }`，缓存键由它生成 |
| `providerModules` | 受信任的 Host ESM 模块说明符数组；相对路径按 Host 进程工作目录解析，不是浏览器扩展或安全沙箱 |
| 状态行 | 输入卡片下方的 `conversation.composer.dock` slot，本插件以 `order: 2` 注册 |

## 维护约定

- 普通上游接口变化只需修改 `providers/` 下对应 Provider；若涉及新的通用版式、响应契约或 Client 交互，还需同步通用核心与相关文档。
- 新增内置额度体系：在 `providers/` 新建 Provider 模块并在 `providers/index.js` 的 `builtinProviders()` 登记；独立扩展通过 `providerModules` 加载。路由识别放在 Provider 自身，不向 `resolve.js` 或 `client.js` 添加供应商分支。详见 [providers.md](providers.md#接入新的额度体系)。
- 通用界面文案来自 `locale/*.json`；Provider 专属文案可放在 `view.messages`。新增全局文案键仍需同步所有语言。
- 修改展示、历史指标或动态凭证时，同步更新 [architecture.md](architecture.md) 与 [providers.md](providers.md)；修改 slot、DOM 钩子或缓存策略时同步更新架构文档。
- 文档中的命令、provider 示例与 DSH 版本需与 `package.json` 保持一致。
