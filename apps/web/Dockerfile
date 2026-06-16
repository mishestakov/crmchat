# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1 — Vite build.
# Build-arg VITE_API_BASE зашивается в bundle на этапе сборки (Vite не читает
# env в рантайме). Меняется — нужен rebuild.
# =============================================================================
FROM node:24-alpine AS builder

RUN apk add --no-cache git \
  && npm install -g pnpm@11.5.2

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/api-client/package.json packages/api-client/

RUN pnpm install --frozen-lockfile --filter "web..."

COPY packages ./packages
COPY apps/web ./apps/web

ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE

RUN pnpm --filter web build

# =============================================================================
# Stage 2 — статика через nginx-alpine.
# =============================================================================
FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
