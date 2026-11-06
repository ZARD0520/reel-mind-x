# 创作 Agent 第一阶段

## 已实现

- 复用 Agent Chat，使用 `glm-4.6v-flash` 和 LangGraph 的单 Agent 工具循环。
- 发送前保存当前画布，并传入选中节点 ID。
- 通过 MCP 读取画布、选中节点和属于当前用户的有效参考资产。
- 每轮由后端先通过 MCP 读取真实画布上下文，不依赖模型先主动调用工具。引用信息包含真实节点 ID。
- 创建文本、图片、视频或音频节点，修改提示词，建立符合现有媒体规则的参考连接。
- 聊天区显示工具执行中、完成或失败；节点变化即时同步到画布。
- 保存运行状态和工具调用记录，刷新后可查看。中断时保留已经完成的操作；自动恢复执行留到第三阶段。
- 默认使用 `glm-4.6v-flash`；在尚未返回任何输出时遇到 429，立即切换到 `glm-4.1v-thinking-flash`，本轮后续步骤继续使用备用模型，下轮对话重新优先使用主模型。仅切换当前模型请求，不重放已完成的 MCP 操作；备用模型也失败时显示简短错误消息。会话标题生成同样支持 429 切换。
- 备用模型通过结构化操作协议适配工具调用，仍由同一 MCP 服务校验和执行；控制用 JSON 不会展示到聊天区。
- 兼容备用模型的 `type: function` 调用格式及尾部字面量换行，格式错误可纠正一次。工具教程或无实际写操作的完成声明会被拦截并纠正，仍不能执行时明确失败。
- `create_nodes` 支持给新节点指定 `referenceNodeIds`，原子完成节点创建与引用连线；引用校验失败时整次修改不落库。
- 本阶段没有生成工具，不会由 Agent 自动提交图片、视频生成。现有聊天积分规则继续生效。

可在画布选中一个故事节点，然后发送：**“根据选中的故事创建四个分镜节点，并连接到这个故事。”**

## MCP 服务

入口：`/canvases/:canvasId/mcp`，采用 MCP Streamable HTTP、无状态请求模式；与现有 API 一样使用登录会话 Cookie 鉴权，限定到当前用户拥有的画布。

Agent 在进程内通过官方 MCP Client 和 InMemoryTransport 连接同一套 MCP Server；工具发现和执行均经过 MCP 协议。外部客户端可通过 HTTP 入口访问同一套工具。

| 工具 | 用途 |
| --- | --- |
| `get_canvas_context` | 读取画布节点、连线、选中节点和有效资产，返回 `revision` |
| `create_nodes` | 每次最多创建 20 个节点，可同时指定参考节点并建立连接，返回实际节点 ID 和新版本 |
| `update_node_prompt` | 修改可编辑节点的提示词 |
| `connect_nodes` | 建立参考连接，校验节点类型、循环依赖及参考图数量 |

写工具必须提供最近返回的 `expectedRevision`；若画布已经变化，工具返回错误，Agent 应重新读取上下文。

前端在本轮执行期间暂停画布手动编辑和自动保存，执行结束后重新同步服务端结果。MCP 工具不会提供删除、生成、扣费或导出能力。

## 运行与验证

新增 `canvas_agent_runs` 表保存执行记录。部署时先执行数据库迁移，并构建共享 LLM 包，再构建后端：

```sh
pnpm --filter @reel/db db:deploy
pnpm --filter @reel/db db:generate
pnpm --filter @reel/llm build
pnpm --filter @reel/api build
pnpm --filter @reel/web build
```

回归测试：

```sh
node --test apps/api/test/canvas-agent.test.cjs
node --test apps/api/test/generation-reliability.test.cjs
node apps/web/test/canvas-agent.browser.cjs
```

浏览器测试默认访问 `http://127.0.0.1:8899`，可通过 `E2E_BASE_URL` 修改。自动化测试使用模拟模型和模拟媒体接口，不提交真实付费生成。

本次验证：MCP 与 Agent 的 17 项自动化测试通过，覆盖工具教程纠正、虚假完成拦截、原子创建与连接、429 切换及错误消息。已用真实备用模型验证“引用图片创建视频节点”；另通过真实 HTTP 聊天接口、图片输入、登录鉴权、MCP、独立数据库 schema 和积分服务，验证视频节点及图片连线实际落库、执行记录保存、仅结算一次对话积分，未提交媒体生成。此前的四分镜真实模型验收、积分与生成 36 项回归及浏览器回归也已通过。

请求对照诊断（只打印接口、模型和响应状态，不输出密钥）：

```sh
node --env-file=apps/api/.env apps/api/test/glm-request-diagnostics.cjs
```

可选真实模型验收（PowerShell；仅操作内存画布，不提交媒体生成）：

```powershell
$env:LIVE_AGENT_SMOKE='1'
node --test --env-file=apps/api/.env apps/api/test/canvas-agent.test.cjs
Remove-Item Env:LIVE_AGENT_SMOKE
```

## 后续阶段

第二阶段再提供生成工具及积分确认卡片；只有用户点击“确认”，后端校验通过后才执行生成。拒绝或未确认时不提交、不扣除生成积分。
