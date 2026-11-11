#!/usr/bin/env bash
# Bite & Brew — PostgreSQL backup (Linux / macOS / WSL).
#
#   DATABASE_URL=postgresql://... ./scripts/backup.sh [backup-dir]
#
# Writes a compressed custom-format dump (restorable with pg_restore), verifies
# it can be read, and deletes local backups older than RETENTION_DAYS (default 30).
# Schedule it (e.g. cron: 30 3 * * *) and copy BACKUP_DIR off-site.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"
BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"

STAMP="$(TZ=Asia/Dhaka date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/bitebrew-$STAMP.dump"

pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$FILE.partial" "$DATABASE_URL"
# Verify the archive is readable before accepting it.
pg_restore --list "$FILE.partial" > /dev/null
mv "$FILE.partial" "$FILE"
sha256sum "$FILE" > "$FILE.sha256"

find "$BACKUP_DIR" -name 'bitebrew-*.dump*' -mtime "+$RETENTION_DAYS" -delete
echo "Backup OK: $FILE ($(du -h "$FILE" | cut -f1))"
