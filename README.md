# ReelMindX

AI 创作平台，以 无限画布 为核心,通过节点化编排驱动各类型 AI 创作能力，从素材生成到成品输出的一站式创作工作台。


## 主要功能

### 已实现
- **无限画布**:自由缩放、平移,节点可任意摆放,承载多种创作流程
- **节点化编排**:支持各类型节点(生成、编辑、素材等),节点间连线定义数据流向
- **多轨道时间轴**:视频/音频多轨,拖拽素材分层、轨道排序、缩放(25%~500%)
- **片段编辑**:拖动、裁剪(trim)、分割、复制、删除,同轨碰撞吸附(不重叠)
- **实时预览**:原生播放,所见即所得;画面内拖拽缩放/移动调整视频尺寸
- **音频混音**:多音频轨同时播放,整轨/单片段静音
- **轨道显隐**:视频轨可隐藏(分层调试)、音频轨可静音
- **撤销/重做**:完整历史栈(Ctrl+Z / Ctrl+Shift+Z)
- **素材管理**:本地上传(视频/图片/音频),自动探测时长/尺寸
- **项目持久化**:自动保存,项目命名
- **AI 生成素材(文生视频 / 图生视频)**
- **无限画布工作流**
- **服务端 FFmpeg 视频合成导出**

### 规划中(AI 能力)
- 全链路AI Agent、资产管理
- AI 字幕、配音、智能剪辑、分镜制作等
- 成品生成、批量生产、成品管理
- 商业化
- 素材分析

## 技术栈

| 层 | 技术 |
|---|---|
| 架构 | Monorepo(Turborepo + pnpm workspace) |
| 后端 | NestJS + Prisma + BullMQ |
| 前端 | React + Vite + Zustand + TanStack Query + Tailwind CSS |
| 数据 | PostgreSQL(持久层) + Redis(队列) |
| 合成 | FFmpeg |

## 项目结构

```
apps/
  api/        # NestJS 后端(含 agent 模块、素材上传、项目 CRUD)
  web/        # React 创作平台前端(无限画布 + 剪辑器)
packages/
  contracts/  # 前后端共享的 Zod 契约(剪辑状态 schema 等)
  db/         # Prisma schema + 生成的 client
```

## 本地开发

### 前置
- Node.js ≥ 20
- pnpm 10+
- Docker(用于 PostgreSQL + Redis)

### 启动

```bash
# 1. 安装依赖
pnpm install

# 2. 启动数据库与 Redis(Docker)
docker compose up -d

# 3. 配置环境变量(复制示例)
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env

# 4. 初始化数据库
pnpm db:migrate

# 5. 启动前后端
pnpm dev
```

- 前端:http://localhost:5173
- 后端:http://localhost:3888

> 端口说明:为避免与本机其他服务冲突,Postgres 用 `5433`、Redis 用 `6380`、后端用 `3888`。可在各 `.env` 中调整。

## 常用脚本

```bash
pnpm dev          # 启动所有应用(开发模式)
pnpm build        # 构建所有应用
pnpm typecheck    # 全量类型检查
pnpm db:migrate   # 运行数据库迁移
pnpm db:generate  # 重新生成 Prisma client
```
