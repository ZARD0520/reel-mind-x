# React（CSR）规则

## 组件
- 函数组件 + TS interface props，命名 `<ComponentName>Props`。
- 文件 PascalCase（`Navbar.tsx`），具名导出，不用 default export。
- JSX 保持声明式、可读；简单条件用简洁语法，避免多余花括号。

## 状态
- **服务端状态**用 **TanStack Query**（数据获取/缓存/同步），禁止用 `useEffect` 拉数据。
- **客户端状态**升级路径：local → context → **Zustand**。
- 优先派生状态 + memo，少用 `useEffect` / `setState`。

## 数据与类型
- API 层封装统一 client，响应类型/校验复用 `packages/contracts` 的 Zod schema。

## 目录结构
- `src/app/` — 应用装配（`router.tsx` 等全局配置）。
- `src/pages/` — 页面级组件（一个路由一个 `XxxPage.tsx`）。
- `src/layouts/` — 布局组件（含 `<Outlet />`）。
- `src/components/` — 可复用展示组件。

## 路由
- 用 **React Router v7**，路由集中在 `src/app/router.tsx` 注册。
- 新增页面：`src/pages/` 建组件 → router 加一条；不在散落各处定义路由。

## 样式
- 用 **Tailwind CSS v4**（`@tailwindcss/vite` 插件 + `src/index.css` 里 `@import 'tailwindcss'`）。
- 优先 utility class，避免另写散落的全局 CSS；复杂重复样式抽成组件而非 `@apply`。
