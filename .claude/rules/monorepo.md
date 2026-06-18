# Monorepo 规则

## 工具
- 包管理用 **pnpm workspaces**，构建/任务编排用 **Turborepo**。
- 跨包引用一律 `workspace:*`，不写相对路径跨 app/package。

## 边界
- 依赖方向：`apps/*` → `packages/*`，单向；`packages/*` 之间不得循环依赖。
- 只从包入口 `index.ts` 导入，禁止 `@app/contracts/src/foo` 这类深路径。

## 共享契约（核心）
- **Zod 是单一事实来源**：schema 定义一次，前后端共享校验 + `z.infer` 推导类型。
- 所有跨端类型/校验放在 `packages/contracts`，不在各 app 里重复定义。

## TypeScript
- 根 `tsconfig.base.json`，各包 `extends`。
- 开启 `strict`、`noUncheckedIndexedAccess`。
- 避免 `enum`，用字面量联合或 `as const` map。
