# Agent 第二阶段扩展自测（2026-11-08）

## 结果

| 范围 | 结果 |
| --- | --- |
| Agent 离线/MCP HTTP 套件 | 39 通过 |
| Agent 计划与隔离数据库套件 | 57 通过，真实模型用例单独运行 |
| 现有生成服务可靠性套件 | 39 通过 |
| 共享 UUID、快照合并和 Agent 生命周期 | 18 通过 |
| 前端历史与持久化协调器单元测试 | 19 通过 |
| 真实图片规划模型 + MCP + 隔离数据库 | 通过 |
| 浏览器交互套件 | 下列 8 个脚本全部通过 |
| contracts、API、主站、管理后台构建 | 通过 |
| 统一完整回归入口 | 17 个检查组通过 |

各套件存在覆盖重叠，不合计总用例数。真实模型测试只实际调用 Planner；图片提供商使用模拟实现，未调用真实出图接口。测试数据库仅允许 localhost，使用随机隔离 schema；未在生产 PM2 环境执行。

## 已复现并修复

1. 旧状态回写可以把 `ready` 节点回退到 `generating`。现在回写在画布锁内重新读取持久化任务，旧观察不会回退结果。
2. 排队期间修改生成尺寸等参数，旧计划仍使用新参数提交。现在校验生成参数、素材和任务绑定，变更后停止旧计划，不额外提交生成。
3. 规划后刷新页面，后台续跑创建的新节点没有 SSE 通知，前端也未持续刷新。现在可续跑任务公开 `backgroundPending` 并同步实际画布，引用列表同时更新。
4. 旧画布自动保存可能删除后台新增节点或覆盖生成结果。现在基于 `baseGraph` 合并保存与同步，保留人工修改、显式删除和后台结果，并检查不会形成自动保存循环。已提交任务的请求绑定也保留在前端同步中。
5. 等待生成期间重命名、删除已提交的兄弟节点，会被最终核验当成旧操作失败。现在在提交媒体之前核验画布编辑阶段并保存检查点，续跑只核验本次新提交结果，生成输入变更仍会停止。
6. 浏览器缓存的旧任务状态会覆盖已完成结果，或覆盖刚开始恢复的状态。现在任务项每次状态转换递增版本，DTO、节点和回执传递状态版本，拒绝旧快照，同时允许显式恢复的新版本。
7. 删除请求未返回时撤销，后续排队保存可能再次删除节点。现在根据排队写入顺序建立基线，同时覆盖失败/不确定新增写入和明确删除；分别测试响应发生在撤销 debounce 前、后。
8. 后台同步失败留下被拒绝的 Promise，会使下一条 Agent 指令在准备画布时失败。现在新指令可在同步失败后独立保存最新画布并执行。
9. 同一生成任务手动重试保存后，原 Agent 对话和回执仍保持失败状态。现在后台重新观察恢复版本，覆盖扫描前已完成的情况；浏览器持续刷新到原回执版本追上任务，不重新规划、提交生成或再次结算对话。对于已停止的部分计划，只刷新其已提交媒体，保留被拒绝的剩余步骤。
10. 图片生成状态同步重新构造已有节点时，丢弃 React Flow 的 `measured` 信息，使仍存在的节点被设置为 `visibility: hidden`。现保留已有节点的运行信息，并在浏览器中监测整个生成过程的可见性变化；覆盖同一节点首次生成、再次生成、实际图片加载及保存后刷新。修复前可见性断言失败，修复后通过，避免只检查 DOM 数量和图片 URL 漏报。

## 扩展覆盖

- 三张分镜：依赖、纵向排列、并发排队、跨实例续跑、部分成功/失败、失败退款和独立重试。
- 规划完成后立即断线；重复请求及丢失提交响应；不会重复规划、提交或结算。
- 两个后台实例同时续跑；租约与回写互斥；缺失计划时拒绝重新调用模型。
- 余额不足、不确定提交结果 `unknown`、事务回滚和冻结积分清理。
- 人工修改参数、删除节点、旧状态回写；陈旧整体图保存与后台新增、完成结果合并。
- 图片参考使用兼容模型并传递真实素材 ID；跨用户素材和跨画布任务查询被拒绝；没有持久化执行作用域不能调用生成工具。
- 浏览器刷新后节点与 `@` 列表更新，保留人工标题修改，后台完成后对话更新，无额外生成请求和自动保存循环。
- 原有快捷键撤销重做、提示词草稿与引用删除、批量部分失败及刷新持久化。
- 慢响应删除后撤销、后台同步中立即发送新指令、同步失败后发送新指令、快速恢复完成及旧任务不得覆盖新任务的素材或回复。

## 重跑

统一入口：`pnpm test:agent --full`；真实规划模型检查可追加 `--live`。共享规则、状态归属、调度覆盖和验证边界见 [一致性与回归入口](./agent-consistency.md)。

```bash
pnpm --filter @reel/contracts build
pnpm --filter @reel/contracts test
pnpm --filter @reel/api test:agent
AGENT_DATABASE_TESTS=1 node --env-file=apps/api/.env --test apps/api/test/canvas-agent-plan.test.cjs
node --test apps/api/test/generation-reliability.test.cjs
LIVE_AGENT_SMOKE=1 node --env-file=apps/api/.env --test --test-name-pattern='live phase two' apps/api/test/canvas-agent-plan.test.cjs
pnpm --filter @reel/api build
pnpm --filter @reel/web build
```

本地主站启动于5173后，分别运行：

```bash
E2E_BASE_URL=http://127.0.0.1:5173 E2E_INSECURE_HTTP=1 node apps/web/test/canvas-agent.browser.cjs
E2E_BASE_URL=http://127.0.0.1:5173 node apps/web/test/canvas-agent-recovery.browser.cjs
E2E_BASE_URL=http://127.0.0.1:5173 node apps/web/test/canvas-history.browser.cjs
E2E_BASE_URL=http://127.0.0.1:5173 node apps/web/test/canvas-prompt-drafts.browser.cjs
E2E_BASE_URL=http://127.0.0.1:5173 node apps/web/test/canvas-chat-mentions.browser.cjs
E2E_BASE_URL=http://127.0.0.1:5173 node apps/web/test/canvas-batch-failures.browser.cjs
E2E_BASE_URL=http://127.0.0.1:5173 node apps/web/test/canvas-save-races.browser.cjs
E2E_BASE_URL=http://127.0.0.1:5173 node apps/web/test/canvas-agent-resume.browser.cjs
```

## 人工验收入口

引用一个故事节点，发送“根据这个故事拆成三个分镜，创建图片节点、填写提示词并生成三张图片”。观察三张图片的依赖、排列和独立状态；生成期间刷新或暂时关闭页面，再返回观察后台进度。对失败图片单独重试，成功图片应保留。

只要求创建节点或填写提示词时，不应提交图片生成。排队中的目标参数被修改后，旧计划应停止并提示依据最新画布重新发送指令。
