# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1 — TDLib build.
# Артефакт: libtdjson.so. Использует tools/tdlib/build.sh (clang-18 + libc++ +
# LTO). Кешируется отдельно — пересобирается только при изменении VERSION/patches.
# =============================================================================
FROM ubuntu:24.04 AS tdlib-builder

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates git \
      make cmake gperf php-cli \
      clang-18 libc++-18-dev libc++abi-18-dev llvm-18 \
      zlib1g-dev libssl-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY tools/tdlib ./tools/tdlib
RUN bash tools/tdlib/build.sh

# =============================================================================
# Stage 2 — API runtime.
# Тот же Ubuntu 24.04, чтобы libc++ ABI совпадал с TDLib. Node 24 через
# NodeSource, pnpm через corepack-pin.
# =============================================================================
FROM ubuntu:24.04 AS runtime

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl \
      libc++1-18 libc++abi1-18 \
      libssl3 zlib1g \
  && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.33.1

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/

RUN pnpm install --frozen-lockfile --filter "api..."

COPY packages/core ./packages/core
COPY apps/api ./apps/api

COPY --from=tdlib-builder /src/tools/tdlib/.build/libtdjson.so /usr/local/lib/libtdjson.so
RUN ldconfig
ENV TDLIB_LIBDIR=/usr/local/lib

EXPOSE 3000
WORKDIR /app/apps/api

CMD ["node", "src/index.ts"]
