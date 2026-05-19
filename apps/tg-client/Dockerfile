# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1 — webpack build TWA-форка.
# setup.sh клонит upstream telegram-tt @ pinned-SHA + накатывает crmchat.patch.
# .env создаём из build-args (TELEGRAM_API_ID/HASH/BASE_URL).
# =============================================================================
FROM node:24-bookworm-slim AS builder

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git bash patch ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY apps/tg-client ./tg-client

# Marker / dist отфильтрованы через .dockerignore, так что setup.sh видит
# либо чистый каталог, либо «остатки от неудачного setup'а» (наш локальный
# clone) → сделает teardown и переклонирует upstream чисто.
RUN cd tg-client && bash setup.sh

ARG TELEGRAM_API_ID
ARG TELEGRAM_API_HASH
ARG TG_BASE_URL=/

RUN printf "NODE_ENV=production\nTELEGRAM_API_ID=%s\nTELEGRAM_API_HASH=%s\nBASE_URL=%s\n" \
      "${TELEGRAM_API_ID}" "${TELEGRAM_API_HASH}" "${TG_BASE_URL}" \
      > /build/tg-client/.env

WORKDIR /build/tg-client
RUN npm ci --no-audit --no-fund
RUN npm run build:production

# =============================================================================
# Stage 2 — статика через nginx-alpine.
# =============================================================================
FROM nginx:1.27-alpine

COPY apps/tg-client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /build/tg-client/dist /usr/share/nginx/html

EXPOSE 80
