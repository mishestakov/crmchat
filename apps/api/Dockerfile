# syntax=docker/dockerfile:1.7

# =============================================================================
# API runtime.
# libtdjson.so едет готовым бинарём из npm-пакета prebuilt-tdlib (попадает в
# node_modules при pnpm install) — своей сборки TDLib больше нет. Ubuntu 24.04
# + Node 24 через NodeSource, pnpm через corepack-pin. libssl3/zlib1g —
# рантайм-зависимости libtdjson.
# =============================================================================
FROM ubuntu:24.04 AS runtime

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl \
      libssl3 zlib1g \
  && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.33.1

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/

RUN pnpm install --frozen-lockfile --filter "api..."

COPY packages/core ./packages/core
COPY apps/api ./apps/api

EXPOSE 3000
WORKDIR /app/apps/api

CMD ["node", "src/index.ts"]
