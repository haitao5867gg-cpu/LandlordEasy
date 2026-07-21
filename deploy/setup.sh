#!/bin/bash
# 服务器初始化脚本
# 用法: ssh root@服务器IP "bash -s" < deploy/setup.sh
# 或者: 登录服务器后执行

set -e

echo "=== 1. 系统更新 ==="
apt update && apt upgrade -y

echo "=== 2. 安装 Docker ==="
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
docker --version

echo "=== 3. 安装 Nginx ==="
apt install -y nginx
systemctl enable nginx

echo "=== 4. 安装 Certbot (Let's Encrypt) ==="
apt install -y certbot python3-certbot-nginx

echo "=== 5. 安装 Node.js 20 + pnpm ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm

echo "=== 6. 创建项目目录 ==="
mkdir -p /opt/landlord-easy
mkdir -p /opt/landlord-easy/data/uploads
mkdir -p /var/www/certbot

echo "=== 7. 配置防火墙 ==="
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== 初始化完成! ==="
echo "下一步:"
echo "  1. 把代码拉到 /opt/landlord-easy"
echo "  2. cp deploy/nginx.conf /etc/nginx/sites-available/landlord-easy"
echo "  3. ln -s /etc/nginx/sites-available/landlord-easy /etc/nginx/sites-enabled/"
echo "  4. 修改 nginx.conf 中的 YOUR_DOMAIN.COM 为实际域名"
echo "  5. docker compose up -d (启动MySQL)"
echo "  6. pnpm install && pnpm build"
echo "  7. 域名备案后: certbot --nginx -d YOUR_DOMAIN.COM"
