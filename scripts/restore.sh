#!/usr/bin/env bash
# Bite & Brew — restore a backup into a database.
#
#   TARGET_DATABASE_URL=postgresql://.../bitebrew_restore ./scripts/restore.sh backups/bitebrew-YYYYMMDD-HHMMSS.dump
#
# Restore into a NEW, empty database first, check it, then point the server's
# DATABASE_URL at it. Never restore over the live database while the café is trading.
set -euo pipefail
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL (an empty database)}"
FILE="${1:?Usage: restore.sh <file.dump>}"
if [[ -f "$FILE.sha256" ]]; then sha256sum --check --quiet "$FILE.sha256"; fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_DATABASE_URL" "$FILE"
psql "$TARGET_DATABASE_URL" -Atc "SELECT 'users=' || count(*) FROM users UNION ALL SELECT 'categories=' || count(*) FROM menu_categories UNION ALL SELECT 'audit_entries=' || count(*) FROM audit_logs UNION ALL SELECT 'migrations=' || count(*) FROM _prisma_migrations"
echo "Restore complete."
