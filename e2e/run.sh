#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/e2e/docker-compose.yml"
export COMPOSE_PROJECT_NAME="landlord_easy_e2e"
export E2E_MYSQL_PORT="${E2E_MYSQL_PORT:-3307}"
export E2E_DATABASE_URL="mysql://e2e:e2e@127.0.0.1:${E2E_MYSQL_PORT}/landlord_easy_e2e"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "错误: 运行 E2E 测试需要 Docker。" >&2
  exit 1
fi

# 只清理由本脚本创建的专用 Compose 项目，确保每次都从空数据库开始。
cleanup
docker compose -f "$COMPOSE_FILE" up -d --wait

cd "$ROOT_DIR"
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter server exec prisma generate
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter server exec prisma db push --force-reset --skip-generate
DATABASE_URL="$E2E_DATABASE_URL" WECHAT_MODE=mock pnpm --filter server seed

# 提前 build 好后端，playwright.config.ts 的 webServer 只负责启动 dist/main，
# 不再依赖 `nest start`（webpack 编译链在部分 Node 版本上会静默失败，见 README）。
rm -rf apps/server/dist apps/server/tsconfig.tsbuildinfo
pnpm --filter server build

pnpm exec playwright test --config=e2e/playwright.config.ts "$@"
