#!/usr/bin/env bash
# Локальный бэкап проекта yearbook-v2 — полный архив на внешний диск.
#
# Использование:
#   scripts/backup-local.sh [путь_назначения]
# По умолчанию пишет в /Volumes/Backup/yearbook-backups
# (замени "Backup" на имя своего внешнего диска или передай путь аргументом).
#
# Исключаются node_modules / .next / .vercel — они тяжёлые и
# восстанавливаются командой npm install. Папка .git (вся история) включается.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-/Volumes/Backup/yearbook-backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"

# Внешний диск подключён?
DEST_PARENT="$(dirname "$DEST")"
if [ ! -d "$DEST_PARENT" ] && [ ! -d "$DEST" ]; then
  echo "❌ Папка назначения недоступна: $DEST" >&2
  echo "   Внешний диск подключён? Или передай путь: scripts/backup-local.sh /Volumes/ИмяДиска/папка" >&2
  exit 1
fi

mkdir -p "$DEST"
ARCHIVE="$DEST/yearbook-v2_${STAMP}.tar.gz"

tar --exclude='node_modules' --exclude='.next' --exclude='.vercel' \
    -czf "$ARCHIVE" -C "$(dirname "$SRC_DIR")" "$(basename "$SRC_DIR")"

# Храним последние 14 архивов, старые удаляем (macOS-совместимо, без xargs -r).
ls -1t "$DEST"/yearbook-v2_*.tar.gz 2>/dev/null | tail -n +15 | while read -r f; do
  rm -f "$f"
done

echo "✅ Бэкап готов: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
