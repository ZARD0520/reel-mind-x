# 环境变量规则

## 统一校验
- 每个 app 在启动时用 **Zod** 校验自己的 env，校验失败立即退出（fail fast）。
- 校验逻辑集中在单一文件（如 `apps/api/src/config/env.ts`），导出 typed config。
- **禁止散落直接读 `process.env`**——只从 typed config 取值。

## 命名
- 大写 + 下划线（`DATABASE_URL`、`REDIS_HOST`）。
- 按域加前缀：`REDIS_*`、`POSTGRES_*` / `DATABASE_URL`、`BULL_*`。

## 文件
- 提交 `.env.example`（含全部 key、占位值、注释），**不提交** `.env`。
- 分层：`.env`（本地默认）、`.env.local`（个人覆盖，git 忽略）。

## 密钥
- 任何密钥/连接串只走环境变量，禁止硬编码进源码或提交进仓库。
