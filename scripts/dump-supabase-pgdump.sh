#!/usr/bin/env bash
# Бэкап базы Supabase напрямую через pg_dump (БЕЗ Docker).
# Данные подключения уже прописаны (Session pooler проекта yearbook).
# Спросит только пароль базы — скрытым вводом.
set -euo pipefail

HOST="aws-1-eu-west-2.pooler.supabase.com"
PORT="5432"
DBUSER="postgres.bnotiyhamfyllcrqwquq"
DBNAME="postgres"

OUT="$HOME/Desktop/yearbook-backups"
mkdir -p "$OUT"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$OUT/supabase_${STAMP}.sql.gz"

echo "Введи ПАРОЛЬ базы Supabase (на экране не показывается), затем Enter:"
read -rs DBPASS
echo ""
echo "Делаю бэкап, подожди…"

PGPASSWORD="$DBPASS" pg_dump \
  -h "$HOST" -p "$PORT" -U "$DBUSER" -d "$DBNAME" \
  --no-owner --no-privileges | gzip > "$FILE"

echo ""
echo "✅ Готово: $FILE ($(du -h "$FILE" | cut -f1))"
echo "   (один файл = структура + все данные)"
