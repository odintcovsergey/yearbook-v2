#!/usr/bin/env bash
# Простой бэкап базы Supabase через официальный Supabase CLI.
# Запускается ОДНОЙ командой, дальше — подсказки на экране.
set -e

echo "────────────────────────────────────────────────"
echo "  Бэкап базы Supabase — 3 простых действия:"
echo "    1) вход через браузер"
echo "    2) выбор проекта + пароль базы"
echo "    3) выгрузка двух файлов на Рабочий стол"
echo "────────────────────────────────────────────────"

WORK="$HOME/supabase-backup"
OUT="$HOME/Desktop/yearbook-backups"
mkdir -p "$WORK" "$OUT"
cd "$WORK"

echo ""
echo "➊  Сейчас откроется БРАУЗЕР — подтверди вход в свой аккаунт Supabase."
read -r -p "    Нажми Enter, когда будешь готов… " _
supabase login

echo ""
echo "➋  Появится список проектов. Выбери 'yearbook' стрелками ↑↓ и нажми Enter."
echo "    Затем введи ПАРОЛЬ БАЗЫ (на экране он не показывается — это нормально), Enter."
read -r -p "    Нажми Enter, чтобы продолжить… " _
supabase link

echo ""
echo "➌  Делаю выгрузку базы, подожди…"
supabase db dump --linked -f "$OUT/schema.sql"
supabase db dump --linked --data-only -f "$OUT/data.sql"

echo ""
echo "✅  ГОТОВО! Бэкап здесь: $OUT"
ls -lh "$OUT"/schema.sql "$OUT"/data.sql
