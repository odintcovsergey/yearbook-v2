#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Pull-деплой yearbook-v2 на Timeweb (ТЗ №1, pull-модель).
# Запускается по таймеру под юзером `yearbook`. Тянет main с GitHub (исходящее —
# проверено рабочим с РФ-сервера), собирает новый релиз в releases/<sha>,
# переключает симлинк current, рестартит сервис, проверяет health и при сбое
# откатывается на предыдущий релиз.
#
# Раскладка (capistrano-стиль):
#   /srv/yearbook/repo                 git clone main (источник)
#   /srv/yearbook/shared/.env.production  секреты (НЕ в git)
#   /srv/yearbook/releases/<sha>/      релиз = код + npm ci + build
#   /srv/yearbook/current -> releases/<sha>
#
# Безопасность: только аддитивно. Текущий /srv/yearbook-v2 не трогается.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="${YB_ROOT:-/srv/yearbook}"
REPO="$ROOT/repo"
RELEASES="$ROOT/releases"
SHARED="$ROOT/shared"
CURRENT="$ROOT/current"
KEEP="${YB_KEEP:-3}"          # сколько релизов хранить
BRANCH="${YB_BRANCH:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# Защита от параллельных запусков таймера
exec 9>"$ROOT/.deploy.lock"
if ! flock -n 9; then
  log "другой деплой уже идёт — выходим"
  exit 0
fi

# 1. Узнаём, есть ли новый коммит (исходящий git до GitHub)
git -C "$REPO" fetch --quiet origin "$BRANCH"
REMOTE_SHA="$(git -C "$REPO" rev-parse --short "origin/$BRANCH")"
CURRENT_SHA="$(basename "$(readlink -f "$CURRENT" 2>/dev/null || echo none)")"

if [ "$REMOTE_SHA" = "$CURRENT_SHA" ]; then
  log "актуально ($CURRENT_SHA) — деплой не нужен"
  exit 0
fi

log "новый коммит $REMOTE_SHA (было $CURRENT_SHA) — деплоим"

# 2. Готовим релиз
NEW="$RELEASES/$REMOTE_SHA"
rm -rf "$NEW"
mkdir -p "$NEW"
git -C "$REPO" archive "origin/$BRANCH" | tar -x -C "$NEW"

# Секреты — из shared (НЕ из git)
ln -sfn "$SHARED/.env.production" "$NEW/.env.production"

# Зависимости. Реестр npm с РФ-сервера НЕДОСТУПЕН (ETIMEDOUT — проверено), поэтому
# node_modules НЕ ставим на каждый деплой, а переиспользуем общий shared/node_modules
# (засеян из рабочего стенда). Сборка идёт офлайн. Если package-lock.json изменился —
# зависимости поменялись: нужен ручной refresh shared/node_modules (rsync с Mac, где
# реестр доступен). Тогда деплой прерываем, чтобы не собрать битый релиз.
if [ ! -d "$SHARED/node_modules" ]; then
  log "ОШИБКА: нет $SHARED/node_modules — засей его (см. README, раздел Установка)"
  rm -rf "$NEW"; exit 1
fi
if ! cmp -s "$NEW/package-lock.json" "$SHARED/package-lock.json"; then
  log "package-lock.json отличается от shared — ИЗМЕНИЛИСЬ ЗАВИСИМОСТИ."
  log "Реестр npm с сервера недоступен. Обнови $SHARED/node_modules вручную:"
  log "  с Mac: npm ci && rsync -a --delete node_modules/ root@SERVER:$SHARED/node_modules/"
  log "  и скопируй новый package-lock.json в $SHARED/. Затем повтори деплой."
  log "Текущий релиз НЕ трогаю."
  rm -rf "$NEW"; exit 1
fi
ln -sfn "$SHARED/node_modules" "$NEW/node_modules"

cd "$NEW"
log "npm run build (офлайн, node_modules из shared)…"
npm run build

# 3. Переключаем симлинк (атомарно) и рестартим
PREV_TARGET="$(readlink -f "$CURRENT" 2>/dev/null || true)"
ln -sfn "$NEW" "$CURRENT"
log "симлинк current → $REMOTE_SHA, рестарт сервиса"
sudo -n systemctl restart yearbook

# 4. Health-check; при сбое — откат
if "$SCRIPT_DIR/health-check.sh"; then
  log "health OK — релиз $REMOTE_SHA активен"
  # Перезапускаем воркер фоновой очереди экспорта (ТЗ №2), чтобы он подхватил
  # новый код рендера из current. || true — если unit ещё не установлен (до
  # первой настройки воркера), деплой не должен падать.
  sudo -n systemctl restart yearbook-render-worker 2>/dev/null \
    && log "yearbook-render-worker перезапущен" \
    || log "yearbook-render-worker не перезапущен (unit не установлен?) — не критично"
else
  log "HEALTH FAIL — откат"
  if [ -n "$PREV_TARGET" ] && [ -d "$PREV_TARGET" ]; then
    ln -sfn "$PREV_TARGET" "$CURRENT"
    sudo -n systemctl restart yearbook
    log "откат на $(basename "$PREV_TARGET") выполнен"
  else
    log "ВНИМАНИЕ: нет предыдущего релиза для отката!"
  fi
  exit 1
fi

# 5. Чистим старые релизы (оставляем KEEP последних по времени)
# shellcheck disable=SC2012
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  log "удаляю старый релиз $(basename "$old")"
  rm -rf "$old"
done

log "готово: $REMOTE_SHA"
