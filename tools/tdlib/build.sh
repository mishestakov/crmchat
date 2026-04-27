#!/usr/bin/env bash
# Кастомный билд TDLib для crmchat.
#
# Workflow:
#   1) клонируем (или fetch) https://github.com/tdlib/td.git в ./.src
#   2) перематываем на ref из VERSION (main = latest)
#   3) накатываем все patches/*.patch
#   4) cmake + make → ./.build/libtdjson.so
#
# Использование (dev):
#   tools/tdlib/build.sh                  # build
#   eval "$(tools/tdlib/build.sh --env)"  # экспортнуть TDLIB_LIBDIR
#
# Обновить патч после правки в .src/:
#   cd tools/tdlib/.src && git diff > ../patches/0001-add-getRawAuthKey.patch
#
# Системные deps (Ubuntu/Debian, один раз на машину):
#   sudo apt-get install make git zlib1g-dev libssl-dev gperf php-cli cmake \
#                        clang-18 libc++-18-dev libc++abi-18-dev
#
# Toolchain:
#   По дефолту используем clang-18 + libc++ + LLVM ar/nm/ranlib + LTO — это
#   то, что рекомендует upstream README. Меньше RAM при сборке (gcc может
#   уйти в 8GB+), бинарь чуть компактнее за счёт LTO. Если clang-18 не
#   найден — fallback на системный компилятор (TDLIB_USE_CLANG=0 чтобы
#   принудительно отключить).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/.src"
BUILD="$ROOT/.build"
REF="$(tr -d '[:space:]' < "$ROOT/VERSION")"
JOBS="${TDLIB_JOBS:-$(nproc)}"
BUILD_TYPE="${TDLIB_BUILD_TYPE:-Release}"

if [[ "${1:-}" == "--env" ]]; then
  echo "export TDLIB_LIBDIR=$BUILD"
  exit 0
fi

CMAKE_ARGS=( -DCMAKE_BUILD_TYPE="$BUILD_TYPE" -DTD_ENABLE_LTO=ON )
USE_CLANG="${TDLIB_USE_CLANG:-1}"
if [[ "$USE_CLANG" == "1" ]] && command -v clang-18 >/dev/null && command -v clang++-18 >/dev/null; then
  echo "[tdlib] toolchain: clang-18 + libc++ + LLVM tools"
  export CC=/usr/bin/clang-18
  export CXX=/usr/bin/clang++-18
  export CXXFLAGS="${CXXFLAGS:-} -stdlib=libc++"
  CMAKE_ARGS+=(
    -DCMAKE_AR=/usr/bin/llvm-ar-18
    -DCMAKE_NM=/usr/bin/llvm-nm-18
    -DCMAKE_OBJDUMP=/usr/bin/llvm-objdump-18
    -DCMAKE_RANLIB=/usr/bin/llvm-ranlib-18
  )
else
  echo "[tdlib] toolchain: system default (clang-18 not found or disabled)"
fi

echo "[tdlib] ref=$REF jobs=$JOBS type=$BUILD_TYPE"

if [[ ! -d "$SRC/.git" ]]; then
  echo "[tdlib] shallow clone (depth=1, branch=$REF) → $SRC"
  git clone --depth 1 --single-branch --branch "$REF" \
    https://github.com/tdlib/td.git "$SRC"
fi

cd "$SRC"
git fetch --depth 1 origin "$REF"
git reset --hard FETCH_HEAD
git clean -fdx

shopt -s nullglob
patches=( "$ROOT/patches"/*.patch )
shopt -u nullglob
if (( ${#patches[@]} > 0 )); then
  for p in "${patches[@]}"; do
    echo "[tdlib] apply $(basename "$p")"
    git apply --check "$p"
    git apply "$p"
  done
else
  echo "[tdlib] no patches to apply"
fi

mkdir -p "$BUILD"
cd "$BUILD"
cmake "${CMAKE_ARGS[@]}" "$SRC"
cmake --build . --target tdjson -j "$JOBS"

echo
echo "[tdlib] built: $BUILD/libtdjson.so"
echo "[tdlib] hint: eval \"\$(tools/tdlib/build.sh --env)\""
