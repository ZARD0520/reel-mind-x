# reel-mind-x

架构：Monorepo
技术栈：NestJS（后端）+ React CSR（应用端）+ TypeScript，队列用 BullMQ + Redis，数据库 PostgreSQL。后续可能新增 Next.js 官网/营销 SEO 页。

## 目录约定

```
apps/        # 可独立部署的应用（api、web，后续 marketing）
packages/    # 共享库（contracts、config、ui 等）
```

- `apps/*` 可依赖 `packages/*`；`packages/*` 之间单向依赖，禁止反向。
- 包之间只从入口（`index.ts`）导入，禁止深路径 import。

## 规则索引

按所在目录加载对应规则：

- 全局 / monorepo → [.claude/rules/monorepo.md](.claude/rules/monorepo.md)
- 环境变量（所有 app）→ [.claude/rules/env.md](.claude/rules/env.md)
- `apps/api/**`（NestJS）→ [.claude/rules/nest.md](.claude/rules/nest.md)
- 数据库（PostgreSQL + Prisma，`packages/db`）→ [.claude/rules/prisma.md](.claude/rules/prisma.md)
- 队列相关（BullMQ + Redis）→ [.claude/rules/bullmq.md](.claude/rules/bullmq.md)
- `apps/web/**`（React）→ [.claude/rules/react.md](.claude/rules/react.md)
