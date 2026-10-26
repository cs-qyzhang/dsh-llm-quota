# 文档

本目录保存 dsh-llm-quota 的内部实现与供应商接口说明。安装、使用和日常配置请先阅读根目录的 [README](../README.md)。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | Host / Client 如何协作、状态行与模型标签的渲染位置、缓存与超时、浮层、本地验证 |
| [providers.md](providers.md) | 支持的供应商、请求与响应格式、自定义 provider、接入新额度体系 |

## 阅读顺序

1. 想安装或使用插件：先看 [README](../README.md)。
2. 想改渲染、缓存或 Host 路由：看 [architecture.md](architecture.md)。
3. 想接新供应商或排查额度字段：看 [providers.md](providers.md)。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| bundle / profile | 插件以 bundle 形式发布；profile 的 `dependencies` 与 `dsh.profile.bundles` 缺一不可 |
| Host / Client | Host 负责凭证、上游请求、缓存；Client 只负责渲染与轮询 |
| provider id | DSH 模型路由名，例如 `zai-coding-cn`、`kimi-coding`、`deepseek-account` |
| `kind` | 插件内部的额度适配器类型，例如 `glm`、`kimi`、`xiaomi-mimo` |
| quota route | 由实时配置解析出的 `{ provider, kind, endpoint, keyNames, mode }`，缓存键由它生成 |
| 状态行 | 输入卡片下方的 `conversation.composer.dock` slot，本插件以 `order: 2` 注册 |

## 维护约定

- 供应商接口变化只改 `providers/` 下对应适配器，客户端响应结构保持不变。
- 新增额度体系需要同时更新 `providers/index.js`、适配器文件、[providers.md](providers.md)，必要时更新 README 的支持范围表。
- 修改 slot、DOM 钩子或缓存策略时同步更新 [architecture.md](architecture.md)。
- 文档中的命令、provider 示例与 DSH 版本需与 `package.json` 保持一致。
