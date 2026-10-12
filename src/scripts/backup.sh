#!/bin/bash
# MongoDB backup with 7-day rotation.
# Usage: npm run backup
# Env: MONGO_URI (default mongodb://127.0.0.1:27017/loreforge), BACKUP_DIR (default ./backups)
set -euo pipefail

MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/loreforge}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
mongodump --uri="$MONGO_URI" --out="$BACKUP_DIR/$STAMP" --quiet
echo "Backup complete: $BACKUP_DIR/$STAMP"

# Keep 7 days of backups
find "$BACKUP_DIR" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +
