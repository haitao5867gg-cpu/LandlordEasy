#!/bin/bash
# MySQL 每日备份脚本
# 部署: sudo cp deploy/backup-mysql.sh /opt/backups/backup-mysql.sh && sudo chmod +x /opt/backups/backup-mysql.sh
# Cron: (crontab -l; echo "0 3 * * * /opt/backups/backup-mysql.sh >> /opt/backups/backup.log 2>&1") | crontab -

BACKUP_DIR=/opt/backups
KEEP_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME=${BACKUP_DIR}/landlord_easy_${DATE}.sql.gz

# 通过 docker exec 执行 mysqldump
docker exec landlord-easy-mysql mysqldump -ulandlord -p"${MYSQL_PASSWORD:-LdEasy2026Pr0dLl9x}" landlord_easy 2>/dev/null | gzip > "$FILENAME"

if [ $? -eq 0 ] && [ -s "$FILENAME" ]; then
    echo "[$(date)] 备份成功: $FILENAME (size: $(du -h "$FILENAME" | cut -f1))"
else
    echo "[$(date)] 备份失败!" >&2
    rm -f "$FILENAME"
    exit 1
fi

# 清理超过30天的旧备份
find "$BACKUP_DIR" -name 'landlord_easy_*.sql.gz' -mtime +$KEEP_DAYS -delete
