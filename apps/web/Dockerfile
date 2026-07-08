FROM node:22-alpine AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN pnpm --filter @reel/web... build

FROM node:22-alpine

WORKDIR /app

COPY apps/web/server.mjs ./server.mjs
COPY --from=build /app/apps/web/dist ./dist

EXPOSE 80

CMD ["node", "server.mjs"]
