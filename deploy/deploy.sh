#!/bin/bash
# 部署/更新脚本
# 在服务器上执行: cd /opt/landlord-easy && bash deploy/deploy.sh <prod|dev>

set -e

DEPLOY_TARGET="${1:-}"
if [[ "$DEPLOY_TARGET" != "prod" && "$DEPLOY_TARGET" != "dev" ]]; then
    echo "用法: bash deploy/deploy.sh <prod|dev>"
    exit 1
fi

# PM2 的进程列表按运行用户隔离(root 和 ubuntu 各自看到不同的进程表)。
# 用 sudo/root 执行本脚本会导致 `pm2 describe` 检测不到已存在的、由部署
# 用户启动的进程，误判"进程不存在"从而新建一个抢占同一端口、必然崩溃的
# 重复进程，而真正在服务的旧进程完全没有被重启、新代码也就没有真正生效
# (2026-08-23 实际踩过一次)。不要用 sudo 执行，用部署专用用户直接运行。
if [[ "$EUID" -eq 0 ]]; then
    echo "错误: 不要用 sudo 或 root 身份执行本脚本。" >&2
    echo "PM2 进程列表按用户隔离，root 身份运行会导致检测不到已存在的部署" >&2
    echo "进程、错误地新建一个抢占端口的重复进程，真正在跑的服务不会被更新。" >&2
    echo "请直接用部署用户运行: bash deploy/deploy.sh $DEPLOY_TARGET" >&2
    exit 1
fi

echo "=== 拉取最新代码 ==="
git pull origin main

echo "=== 安装依赖 ==="
pnpm install

echo "=== 生成 Prisma Client ==="
if [[ "$DEPLOY_TARGET" == "prod" ]]; then
    PRISMA_ENV_FILE="apps/server/.env"
else
    PRISMA_ENV_FILE="apps/server/.env.dev"
fi

if [[ ! -f "$PRISMA_ENV_FILE" ]]; then
    echo "错误: Prisma 环境变量文件不存在: $PRISMA_ENV_FILE" >&2
    exit 1
fi

(
    # 使用 Node 原生 env 文件解析，避免 shell 展开 DATABASE_URL 中的空格或特殊字符。
    # 先移除父进程中的同名变量，确保所选文件的 DATABASE_URL 不会被覆盖。
    DATABASE_URL="$(
        env -u DATABASE_URL node --env-file="$PRISMA_ENV_FILE" -e '
            const databaseUrl = process.env.DATABASE_URL;
            if (!databaseUrl) {
                console.error("错误: Prisma 环境变量文件中未配置 DATABASE_URL: " + process.argv[1]);
                process.exit(1);
            }
            process.stdout.write(databaseUrl);
        ' "$PRISMA_ENV_FILE"
    )"
    export DATABASE_URL

    cd apps/server
    npx prisma generate
    npx prisma db push --skip-generate
)

echo "=== 构建前端 ==="
pnpm --filter landlord-h5 build
pnpm --filter tenant-h5 build

if [[ "$DEPLOY_TARGET" == "dev" ]]; then
    echo "=== 复制 dev 前端构建产物 ==="
    mkdir -p /var/www/landlordeasy/landlord-h5-dev/
    mkdir -p /var/www/landlordeasy/tenant-h5-dev/
    cp -a apps/landlord-h5/dist/. /var/www/landlordeasy/landlord-h5-dev/
    cp -a apps/tenant-h5/dist/. /var/www/landlordeasy/tenant-h5-dev/
fi

echo "=== 构建后端 ==="
# 清理增量编译缓存，避免 dist 被删除后 TypeScript 跳过未变更模块。
rm -rf apps/server/dist
rm -f apps/server/tsconfig.tsbuildinfo
pnpm --filter server build

echo "=== 重启后端服务 ==="
if [[ "$DEPLOY_TARGET" == "prod" ]]; then
    # 用 PM2 管理 Node 进程。生产配置由 Node 显式加载，避免依赖登录 shell 环境。
    if command -v pm2 &> /dev/null; then
        if pm2 describe landlord-easy &> /dev/null; then
            pm2 restart landlord-easy
        else
            pm2 start /usr/bin/node \
                --name landlord-easy \
                --cwd /opt/landlord-easy \
                -- \
                --env-file=/opt/landlord-easy/apps/server/.env \
                /opt/landlord-easy/apps/server/dist/main.js
        fi
        pm2 save
    else
        echo "PM2 未安装,执行: npm install -g pm2"
        echo "然后: pm2 start apps/server/dist/main.js --name landlord-easy"
    fi
else
    # dev 配置由 Node 显式加载独立的 .env.dev 文件。
    if command -v pm2 &> /dev/null; then
        if pm2 describe landlordeasy-server-dev &> /dev/null; then
            pm2 restart landlordeasy-server-dev
        else
            pm2 start /usr/bin/node \
                --name landlordeasy-server-dev \
                --cwd /opt/landlord-easy \
                -- \
                --env-file=/opt/landlord-easy/apps/server/.env.dev \
                /opt/landlord-easy/apps/server/dist/main.js
        fi
        pm2 save
    else
        echo "PM2 未安装,执行: npm install -g pm2"
        echo "然后按 dev 配置启动 landlordeasy-server-dev"
    fi
fi

echo "=== 重载 Nginx ==="
# nginx -t / systemctl reload 需要 root 权限(读证书文件、控制服务)，本脚本
# 整体不能用 sudo 执行(见上方 EUID 检查的原因)，所以这两条单独用 sudo，
# 服务器上需要预先给部署用户配好受限的 NOPASSWD sudoers 规则(只允许这两条
# 具体命令，不是整个脚本)。用 if 显式判断，避免 `cmd1 && cmd2` 在 `set -e`
# 下前半句失败时不会触发脚本退出、却又静默跳过 reload 的坑(2026-08-23 真实
# 踩过一次:普通用户没权限读证书导致 nginx -t 失败，reload 没真正执行，但
# 脚本还是照常打印了"部署完成")。
if sudo -n nginx -t; then
    sudo -n systemctl reload nginx
else
    echo "错误: nginx 配置检查失败,已跳过 reload,部署未完全成功" >&2
    exit 1
fi

echo "=== 部署完成! ==="
