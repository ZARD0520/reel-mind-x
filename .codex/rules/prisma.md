# PostgreSQL + Prisma 规则

## 位置
- Schema 与迁移集中在 `packages/db`（`schema.prisma` + `migrations/`），供后端复用。
- `@reel/db` 包入口直接指向生成的 client（`generated/client`，CJS），apps 从 `@reel/db` 导入 `PrismaClient`/类型，不直接依赖 `@prisma/client`。
- client 是生成产物，无需编译；`build` 脚本即 `prisma generate`，turbo `^build` 会在 dev/build 前自动生成。

## 共享包构建（重要）
- 共享包被 NestJS（Node CJS 运行时）消费时，**包入口必须是 JS 而非 `.ts` 源码**，否则运行时 `require` 会在 `export` 处报错。
- `@reel/db` → 入口为生成的 CJS client；`@reel/contracts`（纯 TS）→ `tsc` 编译到 `dist`（CJS）后由入口指向 `dist`。

## 接入 Nest
- 用可注入的 `PrismaService`（继承 `PrismaClient`），在 `onModuleInit` 连接、`onModuleDestroy` 断开。
- 仓储/数据访问只在 service 层，controller 不直接碰 Prisma。

## 迁移
- 改动一律走迁移：开发 `prisma migrate dev`，生产 `prisma migrate deploy`。
- **禁止 `db push` 进生产**；迁移文件入库版本控制，不手改已提交的迁移。

## 约定
- 模型名 PascalCase 单数（`User`），表名由 `@@map` 显式指定（snake_case 复数）。
- 时间字段 `createdAt` / `updatedAt`（`@updatedAt`）。
- 多步写操作用 `$transaction` 保证原子性。
- Prisma 类型与 Zod 契约分离：Zod（`packages/contracts`）管 API 边界，Prisma 管持久层，不互相复用类型。
