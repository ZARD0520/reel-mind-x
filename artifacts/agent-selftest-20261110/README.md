# 小X Agent 自测记录

日期：2026-11-10。使用独立测试账号、临时 PostgreSQL schema 和浏览器请求替身；没有修改真实用户的画布。

## 验证方式

- 核对数据库中的节点、正文、提示词、引用边、任务、回执和积分，而不是只检查回复是否声称成功。
- 真实模型连续对话使用同一会话，检查前一轮闲聊、写作或失败不会干扰下一轮操作。
- 浏览器测试覆盖实际渲染、输入、SSE 消息、刷新、自动保存与引用更新；这些浏览器用例的服务端响应使用测试替身。另有独立真实 HTTP/SSE、真实视觉模型与真实数据库的集成测试。
- 图片生成闭环测试使用真实规划模型和真实任务、数据库、积分流程，媒体提供商使用替身，没有调用实际付费出图接口。
- 模型繁忙时，连续对话矩阵最多恢复同一请求两次，保留已有回执，避免重复操作。

## 最终检查结果

| 检查组 | 结果 |
| --- | --- |
| 契约、前端数据逻辑、API Agent、生成可靠性 | 100 通过；1 个真实 HTTP 用例按配置跳过并另行单独验证 |
| 隔离数据库 Agent 计划、执行、恢复、积分及回复边界 | 75 通过；6 个真实模型组按配置跳过并另行验证 |
| 既有真实模型集成 | 5 组通过：身份/意图、创建后重命名、三张图片任务闭环、询问技能后重命名、视频与分镜创建及引用 |
| 真实 HTTP/SSE + 视觉输入 + 鉴权 + 积分 | 通过 |
| 新增 15 场景连续对话矩阵 | 15 项全部通过；逐项结果见 live-matrix.json |
| 浏览器 | 9 组通过，见下表 |
| 前后端构建 | 通过 |

## 浏览器覆盖

| 用例 | 检查内容 |
| --- | --- |
| canvas-agent | 对话提交、节点更新、错误文案、刷新持久化、图片更新；隐藏计划与工具记录 |
| canvas-agent（非安全 HTTP） | 无原生 randomUUID 时仍可提交、更新和恢复 |
| canvas-agent-recovery | 刷新后后台任务继续，保留用户编辑，不重复提交、不产生保存循环 |
| canvas-agent-resume | 重试保存更新原回复，不重复提交生成或聊天 |
| canvas-save-races | Agent 操作与正在进行或失败的自动保存交错 |
| canvas-history | 撤销、重做、拖拽、删除、连线、重命名、保存和刷新 |
| canvas-prompt-drafts | 草稿切换、清空与刷新；不意外触发生成 |
| canvas-chat-mentions | @ 引用的导航、删除、撤销、重做及提交一致性 |
| canvas-batch-failures | 批量结果混合成败、纵向布局、删除与刷新，不重复生成 |

## 连续对话矩阵

1. 自我介绍保持“小X”身份。
2. 询问技能时说明真实画布能力。
3. 只在聊天里写故事，不创建节点。
4. 分析本轮引用的小狗故事，不混入前一轮聊天写的小猫故事。
5. 创建文本节点，核对标题和完整正文。
6. 重命名引用节点，确认不会改动另一个选中节点。
7. 修改提示词，保留标题和正文。
8. 根据故事创建图片节点及依赖，但不实际出图。
9. 根据图片创建视频节点及引用，不生成视频。
10. 创建独立音频节点，不生成音频。
11. 已有文本与音频建立参考连接。
12. 操作后查询画布节点数量，不重复前一轮操作。
13. 询问如何出图，不实际生成，也不暴露内部工具、字段或编号。
14. 请求尚不支持的视频生成，不能假报成功或修改画布。
15. 目标节点不存在时澄清，不能误改选中的其他节点。

逐项请求、实际回复、节点数量变化和执行结果保存在 [live-matrix.json](live-matrix.json)，全部是合成测试材料。

## 本轮发现并处理

- 使用方法问答曾暴露内部工具名称、字段和节点 ID：加强只读识别，回答上下文使用创作内容和标题，回复含内部信息时重新生成；新增有限重试和禁止泄露的回归测试。
- 历史聊天故事可能干扰当前引用素材分析：明确当前画布/引用问答的路由与素材优先级；测试同时检查正确情节和错误来源污染。
- 模型根据历史创建记录误算节点数量：提供当前画布的精确总数和各类型统计；画布问答使用确定性采样。
- 明确指定的目标不存在时，模型有时擅自挑选其他节点重命名：在规划前核对目标名称，缺失或有歧义时直接澄清；唯一名称绑定到实际目标，有明确引用的同名节点仍可正常操作。“不要创建其他节点”不会绕过该校验；创建后再重命名仍使用原有步骤引用。
- 备用模型可能返回字符串中未转义的换行：仅对解析器明确报告的控制字符错误进行字符串转义规范化，保留原字符串值、严格 Schema、节点引用及操作校验。
- 新分流导致生成可靠性测试的模型替身和只读计划断言过时：适配对话分支，保留成功扣费、失败退款、中断退款和鉴权检查。
- Windows 无创建符号链接权限：在该环境注入与跨用户符号链接相同的 realpath 返回结果，继续验证禁止跨用户读取，没有跳过该安全断言。
- 恢复类浏览器测试使用了另一端口：统一在本仓库 8899 测试服务执行。

前端构建只有现有的大包体积提示，退出码为 0；PowerShell 的 stderr 错误记录不代表构建失败。

## 可复现命令（PowerShell，仓库根目录）

```powershell
node --test packages/contracts/test/*.test.cjs apps/web/test/*.test.cjs apps/api/test/canvas-agent.test.cjs apps/api/test/generation-reliability.test.cjs

$env:AGENT_DATABASE_TESTS='1'
node --env-file=apps/api/.env --test apps/api/test/canvas-agent-plan.test.cjs
$env:AGENT_DATABASE_TESTS='0'

$env:LIVE_AGENT_SMOKE='1'
node --env-file=apps/api/.env --test --test-name-pattern='live' apps/api/test/canvas-agent-plan.test.cjs
node --env-file=apps/api/.env --test --test-name-pattern='live HTTP chat persists' apps/api/test/canvas-agent.test.cjs
$env:LIVE_AGENT_SMOKE='0'

pnpm.cmd --filter @reel/api build
pnpm.cmd --filter @reel/web build
```

浏览器测试先启动 `pnpm.cmd --filter @reel/web dev --host 127.0.0.1`，设置 `$env:E2E_BASE_URL='http://127.0.0.1:8899'`，然后执行上表对应的 `node apps/web/test/<用例名>.browser.cjs`。非安全 HTTP 变体额外设置 `$env:E2E_INSECURE_HTTP='1'`。
