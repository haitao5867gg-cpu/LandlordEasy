#!/bin/bash
# Let's Encrypt 证书申请
# 前提: 域名已备案 + DNS 已解析到服务器IP + Nginx 已运行
# 用法: bash deploy/certbot.sh your-domain.com

DOMAIN=$1
if [ -z "$DOMAIN" ]; then
    echo "用法: bash deploy/certbot.sh your-domain.com"
    exit 1
fi

echo "=== 为 $DOMAIN 申请 SSL 证书 ==="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@"$DOMAIN"

echo "=== 设置自动续期 ==="
# certbot 安装时已自动添加 systemd timer，检查一下
systemctl status certbot.timer

echo "=== 完成! ==="
echo "证书路径: /etc/letsencrypt/live/$DOMAIN/"
echo "自动续期已配置,证书到期前会自动更新"
