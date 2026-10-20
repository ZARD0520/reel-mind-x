# 积分与管理后台

## 项目结构与启动

- `apps/admin`：React + Vite + Tailwind CSS 4 + TanStack Query 管理后台，与 web、api 同级。Tailwind 版本和 Vite 插件接入方式与 web 一致；`styles.css` 仅保留主题变量和基础样式，按钮/表单与布局容器分别封装在 `src/components/controls.tsx`、`containers.tsx`。
- 后台使用 React Router：`/login`、`/overview`、`/users`、`/tasks`、`/ledger`、`/prices`、`/audits`。菜单页面位于 `apps/admin/src/pages`，共享布局位于 `layouts`，路由与菜单定义位于 `app`；页面按路由懒加载。用户流水筛选保存在 URL 查询参数中，支持刷新和前进后退。
- `packages/contracts/src/credits.ts`：共享校验、类型、积分流水文案。
- `packages/api-client`：两个前端共用的积分与管理接口客户端。
- `packages/static-server`：两个前端共用的生产静态服务器。

```bash
pnpm install --frozen-lockfile
pnpm --filter @reel/db db:deploy
pnpm --filter @reel/db db:generate
pnpm dev
```

创作台 http://localhost:8899，后台 http://localhost:8898，API http://localhost:3888。`pnpm dev` 会先构建共享依赖，再启动所有应用和监听器。

先在创作台注册账号，再明确授予该账号管理员权限：

```bash
pnpm --filter @reel/db admin:grant your-email@example.com
```

命令读取 `packages/db/.env`，写入审计日志。没有默认管理员、默认密码或公开的角色提升接口。后台沿用创作台的账号和 HttpOnly 会话，每个管理接口同时校验登录、账号状态和数据库中的管理员角色。

单独启动后台：先 `pnpm --filter @reel/admin^... build` 构建依赖，再 `pnpm --filter @reel/admin dev`。

## 默认规则

首次开通积分账户时赠送 **100 积分**，包括升级前已有用户，每个账号只赠送一次。修改试用额度只影响尚未开通积分账户的用户。

| 类型 | 默认消耗 |
| --- | --- |
| 文本 | 每次 1 积分 |
| 图片 | 每张 10 积分 |
| 视频 | 每秒 10 积分，5 秒为 50、10 秒为 100 |
| Agent Chat | 每次对话 1 积分，自动标题包含在内 |

这是可编辑的初始平台定价，不是供应商报价。精确模型规则优先于同类型的 `*` 默认规则。禁用精确规则后，不会回退到默认规则继续生成。视频可按次或按秒计费，其他类型按次计费。

默认每用户最多同时处理 **3 个生成任务或对话**，每日提交最多占用 **10000 积分**，均可在后台调整。每日上限按 UTC 自然日统计，冻结和已扣除计入额度，失败退还释放额度；设为 0 表示不限制。结果未知的任务仍占用并发与冻结额度。

收费入口：统一生成任务、旧版图片/视频接口、文本接口、画布 Agent Chat。有画布/项目归属的旧入口通过统一任务结算，避免重复扣费。尚未接入模型的音频生成保持不可用；上传、资产管理、剪辑、规则混剪和未实际调用模型的占位 Agent 队列不收费。

## 结算行为

- 创建任务、占位资产、报价快照、冻结积分在同一事务内；余额不足 HTTP 402，使用上限 HTTP 429，整体回滚。
- 同一用户相同任务 `requestId` 只创建和冻结一次；更换参数返回冲突。
- 每个生成结果独立结算：4 张图片成功 3 张，只扣 3 张费用，失败的 1 张退还。
- 成功把冻结转为累计消耗；失败退回可用余额。行锁、唯一流水和数据库非负约束防止重复结算和并发透支。
- 响应丢失、结果待确认时保留冻结，查询原供应商任务，不自动重新发起付费生成。
- 保存结果后进程退出，任务恢复器补结算。改价不影响已提交任务；恢复失败的保存步骤时，按原价重新冻结已退还额度，不重复生成。
- 同步文本/流式对话失败或取消时退还，进程退出遗留的临时冻结超过 30 分钟由扫描器退还。对话保存和扣除在同一事务内。
- 人工调整只能扣减可用积分，必须填写原因，支持调整请求幂等。
- 删除画布会终止未完成的生成并退还冻结积分，已完成结果按原价结算；任务、报价和流水保留供后台追溯。创建任务与删除画布互斥，避免删除期间遗留冻结。

流水记录赠送、调整、冻结、扣除、退还，以及操作后可用/冻结余额、任务或会话 ID、操作人。

## 后台与创作台

后台提供数据概览、用户搜索/启停/积分调整、生成任务查询与失败详情、积分流水、模型定价与启停、试用额度/使用上限、操作审计。管理员账号只能通过本地命令管理；后台没有会重新发起供应商扣费的“一键重跑”。

创作台主页和画布顶部提供余额/流水入口，节点提示词面板按模型、数量和时长显示预计积分，对话显示单次费用。最终以服务端提交时保存的报价为准。

## 部署与测试

`docker-compose.prod.yml` 新增 admin 服务，默认端口 `8081`，可用 `ADMIN_PORT` 调整。两个前端通过各自 `/api` 代理访问 API；生产环境使用 HTTPS，以支持 Secure 会话 Cookie。

```bash
pnpm --filter @reel/api build
pnpm --filter @reel/admin... build
pnpm --filter @reel/web... build
node --test apps/api/test/generation-reliability.test.cjs
node apps/admin/test/admin.browser.cjs
```

数据库测试在本地 PostgreSQL 创建临时独立 schema，并在结束后移除；浏览器测试需要启动两个前端和安装 Chrome。测试使用假供应商/拦截接口，不调用付费模型或修改真实账号。

本版通过后台发放积分，不包含支付、充值、套餐订阅、积分过期或供应商实际成本对账。
