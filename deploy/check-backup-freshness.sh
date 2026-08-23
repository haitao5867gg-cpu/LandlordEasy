#!/bin/bash
# 每日备份存活检查:确认最新一份 landlord_easy 备份不超过30小时未更新
# 部署: sudo cp deploy/check-backup-freshness.sh /opt/backups/check-backup-freshness.sh && sudo chmod +x /opt/backups/check-backup-freshness.sh
# Cron(/etc/cron.d/ 语法,需要 root 用户名字段): 30 8 * * * root /opt/backups/check-backup-freshness.sh
LATEST=$(ls -t /opt/backups/landlord_easy_*.sql.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') 警告: 找不到任何备份文件" >> /opt/backups/freshness-check.log
  exit 1
fi
AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$LATEST") ) / 3600 ))
if [ "$AGE_HOURS" -gt 30 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') 警告: 最新备份 $LATEST 已经 ${AGE_HOURS} 小时没更新" >> /opt/backups/freshness-check.log
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') 正常: 最新备份 $LATEST 是 ${AGE_HOURS} 小时前生成的" >> /opt/backups/freshness-check.log
fi
