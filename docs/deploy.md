# 线上部署

本项目提供 Docker Compose 生产部署配置。默认只占用宿主机 `8080` 端口, 不使用 `3000` 或 `3001`。

## 1. 准备服务器

服务器需要安装:

- Docker
- Docker Compose v2
- Git

## 2. 配置环境变量

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`:

- `PUBLIC_URL` / `CORS_ORIGIN`: 改成线上访问地址, 例如 `http://服务器IP:8080` 或 `https://域名`
- `WEB_PORT`: 默认 `8080`, 如果该端口也被占用, 改成其他端口
- `POSTGRES_PASSWORD`: 改成强密码
- `SESSION_SECRET`: 改成随机长字符串
- `GLM_API_KEY`: 填入真实智谱 API Key

## 3. 启动

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

启动后访问:

```text
http://服务器IP:8080
```

如果你把 `WEB_PORT` 改成了其他端口, 访问对应端口。

## 4. 查看状态和日志

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f web
```

## 5. 更新部署

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

API 容器启动时会自动执行 Prisma 迁移:

```bash
pnpm --filter @reel/db db:deploy
```

## 端口说明

- 宿主机 `8080`: 前端入口, 同时代理 `/api` 和 `/static`
- 容器内 `3888`: NestJS API, 不映射到宿主机
- 容器内 `5432`: PostgreSQL, 不映射到宿主机
- 容器内 `6379`: Redis, 不映射到宿主机

因此服务器本地已有的 `3000` 和 `3001` 不会被占用。

## PM2：Agent 部署诊断日志

Agent 第二阶段图片生成需要同时发布 API 和主站静态文件。复用现有 PostgreSQL、Redis 和生成 worker（当前 API 的 `GenerationTasksWorkerModule`），不需要新增数据库迁移或独立 Agent 进程。API 内的持久化扫描器会恢复已交付的图片计划；多个 PM2 实例共用数据库租约防止重复提交。实际出图仍需要现有图片模型配置、积分价格和生成服务可用。详细执行边界见 [画布 Agent 架构](./canvas-agent-plan-execute.md)。

API 默认读取工作目录 `cwd` 下的 `.env`，不会自动读取 `.env.production`。PM2 或启动脚本已注入的同名环境变量优先。更新 API 代码后重新构建，再重启实际的 API 进程：

```bash
pnpm --filter @reel/api build
pm2 restart <API进程名> --update-env
pm2 logs <API进程名> --lines 200
```

日志默认开启，不需要设置 debug 开关。启动时搜索 `agent.runtime`：包含 PID、Node 版本、工作目录、默认 `.env` 的路径和是否存在、`.env.production` 是否存在、模型 Key 是否配置、去掉账号密码和查询参数的 GLM 地址、Agent 主备模型及数据库主机。不会打印密钥、数据库密码、环境文件内容。

发送一次聊天后搜索 `agent.stage`、`agent.failed` 或 `Agent chat failed`。每条请求带同一个 `requestId`，执行阶段还带 `runId`，并记录阶段、耗时、错误码；响应头 `X-Agent-Request-Id` 可用于核对。关键阶段：

| phase / event | 排查位置 |
| --- | --- |
| `request.received` | 请求已通过认证/参数校验并进入 Agent 控制器；没有这条时先检查画布保存、登录、代理及进程版本 |
| `request.lookup` / `run.claim` | 请求记录、数据库迁移、任务租约；`P2021` / `P2022` 常用于定位缺表、缺字段 |
| `credits.quote` / `credits.hold` | 对话模型是否启用、价格、积分预留 |
| `context.connect` / `tools.discover` | MCP 初始化与工具注册 |
| `agent.model_started` / `agent.model_failed` | 实际模型、HTTP 状态及厂商错误码；失败记录不包含完整厂商响应体 |
| `plan.validate` / `plan.persist` | 规划结构校验、持久化 |
| `tool.execute` / `result.verify` | 画布操作及结果核验 |
| `delivery.commit` / `delivery.read` | 对话保存、扣费及结果交付 |

退款、租约释放和错误消息保存失败也会单独记录，避免这些后续错误掩盖原始故障。日志不主动打印对话正文、节点内容、原始计划或图片 base64；数据库异常仅保留错误码、表/字段信息和调用位置。把同一 `requestId` 的日志连同启动时的 `agent.runtime` 一起提供，即可区分环境配置、数据库、积分和模型调用问题。

### 页面秒失败，但没有 Agent 请求日志

浏览器发请求前的异常不会出现在 PM2 后端日志里。已复现的一个原因是通过 HTTP + IP/域名访问时处于非安全上下文，`crypto.randomUUID` 不存在，旧版 Chat 在构造请求体时直接抛错。现已统一使用兼容 UUID 工具，保留合法的 v4 UUID 格式，不要求修改请求 ID 校验。

此修复需要更新前端：运行 `pnpm --filter @reel/web build`，将新 `apps/web/dist` 发布到实际静态站点目录，刷新页面。仅更新 API 构建不会替换浏览器中的代码。

前端提交失败时，浏览器 Console 会出现 `[CanvasAgent] submission failed`，带 `prepare_canvas`、`create_conversation` 或 `send_agent` 阶段，以及安全上下文、UUID API 可用性和错误类型；不打印对话正文或 HTTP 响应体。这些日志应在浏览器中查看。

非安全源回归（从本地测试服务器提供页面资源，浏览器保持真实的 HTTP 非安全上下文）：

```bash
E2E_BASE_URL=http://127.0.0.1:5173 E2E_INSECURE_HTTP=1 node apps/web/test/canvas-agent.browser.cjs
```
