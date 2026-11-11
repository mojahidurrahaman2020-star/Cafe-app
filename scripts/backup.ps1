# Bite & Brew — PostgreSQL backup for Windows (PowerShell).
#   $env:DATABASE_URL="postgresql://..."; .\scripts\backup.ps1 -BackupDir D:\BiteBrewBackups
# Requires PostgreSQL client tools (pg_dump, pg_restore) on PATH.
# Schedule with Task Scheduler (daily, e.g. 03:30) and copy the folder off-site.
param([string]$BackupDir = ".\backups", [int]$RetentionDays = 30)
$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "Set DATABASE_URL" }
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "Bangladesh Standard Time").ToString("yyyyMMdd-HHmmss")
$file = Join-Path $BackupDir "bitebrew-$stamp.dump"
& pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$file.partial" $env:DATABASE_URL
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
& pg_restore --list "$file.partial" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "backup verification failed" }
Move-Item "$file.partial" $file
(Get-FileHash $file -Algorithm SHA256).Hash | Out-File "$file.sha256"
Get-ChildItem $BackupDir -Filter "bitebrew-*.dump*" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } | Remove-Item
Write-Host "Backup OK: $file"
