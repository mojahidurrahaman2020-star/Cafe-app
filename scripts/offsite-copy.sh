#!/usr/bin/env bash
# Bite & Brew — copy local backups to cloud storage whenever the internet is available.
#
# Uses rclone (https://rclone.org), which supports Google Drive, OneDrive, Dropbox,
# Backblaze B2, S3 and more. One-time setup on the café server:
#   1. Install rclone, then run `rclone config` and create a remote, e.g. named "cloud".
#   2. Schedule this script hourly (cron: 15 * * * *  or Windows Task Scheduler).
#
#   REMOTE=cloud:bitebrew-backups BACKUP_DIR=./backups ./scripts/offsite-copy.sh
#
# If the internet is down the copy simply fails and is retried next hour; the café keeps
# working. Copies are additive (old backups are kept off-site even after local cleanup).
set -euo pipefail
: "${REMOTE:?Set REMOTE, e.g. cloud:bitebrew-backups}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
rclone copy "$BACKUP_DIR" "$REMOTE" --include 'bitebrew-*.dump*' --immutable --transfers 2 --retries 3 --low-level-retries 5 --log-level NOTICE
echo "Off-site copy finished: $(date -Iseconds)"
