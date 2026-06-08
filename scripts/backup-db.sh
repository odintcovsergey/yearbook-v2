#!/usr/bin/env bash
# Дамп базы Supabase в сжатый .sql.gz на внешний диск.
#
# Строка подключения НЕ хранится в коде. Берётся из переменной окружения
# SUPABASE_DB_URL или передаётся первым аргументом.
#
# Где взять строку подключения:
#   Supabase → Project Settings → Database → Connection string → вкладка "URI",
#   режим "Session pooler" (порт 5432). Скопируй и подставь свой пароль.
#
# Использование:
#   SUPABASE_DB_URL="postgresql://..." scripts/backup-db.sh
#   scripts/backup-db.sh "postgresql://..." /Volumes/ИмяДиска/папка
set -euo pipefail

DB_URL="${1:-${SUPABASE_DB_URL:-}}"
DEST="${2:-/Volumes/Backup/yearbook-backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"

if [ -z "$DB_URL" ]; then
  echo "❌ Нет строки подключения. Задай SUPABASE_DB_URL или передай URL первым аргументом." >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "❌ Нет pg_dump. Установи: brew install postgresql@16" >&2
  exit 1
fi

mkdir -p "$DEST"
OUT="$DEST/supabase_${STAMP}.sql.gz"

# --no-owner / --no-privileges — чтобы дамп легко разворачивался в новый проект.
pg_dump "$DB_URL" --no-owner --no-privileges | gzip > "$OUT"

echo "✅ Дамп БД готов: $OUT ($(du -h "$OUT" | cut -f1))"
