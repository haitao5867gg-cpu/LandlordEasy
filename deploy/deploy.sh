#!/bin/bash
# 部署/更新脚本
# 在服务器上执行: cd /opt/landlord-easy && bash deploy/deploy.sh

set -e

echo "=== 拉取最新代码 ==="
git pull origin main

echo "=== 安装依赖 ==="
pnpm install

echo "=== 生成 Prisma Client ==="
cd apps/server
npx prisma generate
npx prisma migrate deploy
cd ../..

echo "=== 构建前端 ==="
pnpm --filter landlord-h5 build
pnpm --filter tenant-h5 build

echo "=== 构建后端 ==="
# 清理增量编译缓存，避免 dist 被删除后 TypeScript 跳过未变更模块。
rm -rf apps/server/dist
rm -f apps/server/tsconfig.tsbuildinfo
pnpm --filter server build

echo "=== 重启后端服务 ==="
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

echo "=== 重载 Nginx ==="
nginx -t && systemctl reload nginx

echo "=== 部署完成! ==="
