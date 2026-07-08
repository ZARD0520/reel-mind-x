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
