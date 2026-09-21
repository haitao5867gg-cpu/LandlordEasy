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

# 签署版合同PDF自备份:微签平台侧只保留1G且期限不明,我方服务器
# data/private/contracts/ 是唯一完整归档(2026-09-21 GasCan确认要求自存),
# 每天跟数据库一起备一份,文件名带日期可追溯当天签了哪些合同。
CONTRACT_SRC=/opt/landlord-easy/data/private/contracts
CONTRACT_TAR=${BACKUP_DIR}/contracts_${DATE}.tar.gz
if [ -d "$CONTRACT_SRC" ] && [ -n "$(ls -A "$CONTRACT_SRC" 2>/dev/null)" ]; then
    tar -czf "$CONTRACT_TAR" -C "$CONTRACT_SRC" .
    echo "[$(date)] 合同归档备份成功: $CONTRACT_TAR (size: $(du -h "$CONTRACT_TAR" | cut -f1))"
else
    echo "[$(date)] 合同目录为空或不存在,跳过归档备份" >&2
fi
find "$BACKUP_DIR" -name 'contracts_*.tar.gz' -mtime +$KEEP_DAYS -delete
