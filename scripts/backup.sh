#!/bin/bash
# Usage: ./scripts/backup.sh
# Creates a timestamped pg_dump of the riga_navigator database.
# Restore with: psql "$DATABASE_URL" < backups/backup_YYYYMMDD_HHMMSS.sql

DB_URL="${DATABASE_URL:-postgresql://riga:riga_dev_password@localhost:5432/riga_navigator}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
OUTPUT="$DIR/backup_${TIMESTAMP}.sql"

mkdir -p "$DIR"
pg_dump "$DB_URL" > "$OUTPUT"

if [ $? -eq 0 ]; then
  SIZE=$(du -sh "$OUTPUT" | cut -f1)
  echo "Backup saved: $OUTPUT ($SIZE)"
else
  echo "Backup failed." >&2
  rm -f "$OUTPUT"
  exit 1
fi
