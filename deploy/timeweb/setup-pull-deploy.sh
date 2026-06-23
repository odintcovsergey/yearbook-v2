#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Разовая подготовка pull-деплоя на сервере Timeweb (ТЗ №1). Идемпотентно.
# НЕ переключает боевой сервис и НЕ включает таймер — только готовит раскладку
# /srv/yearbook и собирает первый релиз. Cutover и вооружение таймера — руками,
# отдельными шагами (см. README, разделы 4–6).
#
# Запуск от root:  bash deploy/timeweb/setup-pull-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT=/srv/yearbook
OLD=/srv/yearbook-v2          # текущий рабочий стенд (источник секретов)
REPO_URL=https://github.com/odintcovsergey/yearbook-v2.git
SVC_USER=yearbook

log() { echo "[setup] $*"; }

# 1. Каталоги
log "создаю $ROOT/{repo,shared,releases}"
mkdir -p "$ROOT"/{shared,releases}
chown -R "$SVC_USER:$SVC_USER" "$ROOT"

# 2. Клон репозитория (если ещё нет)
if [ ! -d "$ROOT/repo/.git" ]; then
  log "git clone $REPO_URL → $ROOT/repo"
  sudo -u "$SVC_USER" git clone "$REPO_URL" "$ROOT/repo"
else
  log "repo уже есть — git fetch"
  sudo -u "$SVC_USER" git -C "$ROOT/repo" fetch --quiet origin main
fi

# 3. Секреты из старого стенда (не перезаписываем, если уже скопированы)
if [ ! -f "$ROOT/shared/.env.production" ]; then
  if [ -f "$OLD/.env.production" ]; then
    log "копирую .env.production из $OLD в shared/"
    cp "$OLD/.env.production" "$ROOT/shared/.env.production"
    chown "$SVC_USER:$SVC_USER" "$ROOT/shared/.env.production"
    chmod 600 "$ROOT/shared/.env.production"
  else
    log "ВНИМАНИЕ: $OLD/.env.production не найден — положи секреты в $ROOT/shared/ вручную"
  fi
else
  log "shared/.env.production уже на месте — не трогаю"
fi

# 3b. Засев node_modules в shared (реестр npm с РФ-сервера недоступен → ставить
#     на каждый деплой нельзя; переиспользуем общий, собранный из рабочего стенда).
if [ ! -d "$ROOT/shared/node_modules" ]; then
  if [ -d "$OLD/node_modules" ]; then
    log "копирую node_modules ($(du -sh "$OLD/node_modules" | cut -f1)) из $OLD в shared/ — это займёт время…"
    cp -a "$OLD/node_modules" "$ROOT/shared/node_modules"
    cp "$OLD/package-lock.json" "$ROOT/shared/package-lock.json"
    chown -R "$SVC_USER:$SVC_USER" "$ROOT/shared/node_modules" "$ROOT/shared/package-lock.json"
    log "node_modules + package-lock засеяны в shared"
  else
    log "ВНИМАНИЕ: $OLD/node_modules не найден — засей shared/node_modules вручную (rsync с Mac)"
  fi
else
  log "shared/node_modules уже на месте — не трогаю"
fi

# 4. sudoers: yearbook может рестартить сервис без пароля
SUDOERS=/etc/sudoers.d/yearbook-deploy
if [ ! -f "$SUDOERS" ]; then
  log "ставлю sudoers $SUDOERS"
  cat > "$SUDOERS" <<SUDO
$SVC_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart yearbook, /usr/bin/systemctl is-active yearbook
SUDO
  chmod 440 "$SUDOERS"
  visudo -cf "$SUDOERS"
else
  log "sudoers уже есть"
fi

log "готово. Дальше: 1) собрать первый релиз — sudo -u $SVC_USER $ROOT/repo/deploy/timeweb/deploy.sh"
log "          2) протестировать на порту 3001 (см. README раздел 4)"
log "          3) cutover yearbook.service на $ROOT/current (README раздел 5)"
log "          4) вооружить таймер (README раздел 6)"
