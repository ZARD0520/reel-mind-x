FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV FFMPEG_PATH="/usr/bin/ffmpeg"
ENV FFPROBE_PATH="/usr/bin/ffprobe"
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories
RUN apk add --no-cache ffmpeg
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai-gen/package.json packages/ai-gen/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/llm/package.json packages/llm/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/reel_mind?schema=public"
RUN pnpm --filter @reel/api... build

EXPOSE 3888

CMD ["sh", "-c", "pnpm --filter @reel/db db:deploy && pnpm --filter @reel/api start"]
