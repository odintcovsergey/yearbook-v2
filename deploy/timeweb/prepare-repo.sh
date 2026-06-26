#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ExecStartPre деплоя yearbook-v2: обновляет рабочее дерево /srv/yearbook/repo до
# свежего main с ПЕРВОГО доступного источника (primary gitflic → fallback origin),
# чтобы сам deploy.sh был актуален к моменту ExecStart. ExecStartPre завершается
# ДО ExecStart, поэтому deploy.sh не переписывается «на ходу».
#
# Раньше юнит делал это двумя жёсткими `git ... origin main` — из-за чего SSL-флап
# GitHub останавливал деплой. Теперь источник выбирается отказоустойчиво и общей
# логикой (select-source.sh), той же, что использует deploy.sh.
#
# Честный провал: если ни один источник не отвечает — exit 1 (деплой не едет),
# а не молчаливое обновление со старого состояния.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="${YB_ROOT:-/srv/yearbook}"
REPO="$ROOT/repo"
BRANCH="${YB_BRANCH:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [prepare-repo] $*"; }

# shellcheck source=/dev/null
source "$SCRIPT_DIR/select-source.sh"

ACTIVE_REMOTE="$(select_active_remote "$BRANCH")" || {
  log "НИ ОДИН источник не отвечает ($DEPLOY_REMOTES) — обновление репо отменено"
  exit 1
}
if [ "$ACTIVE_REMOTE" = "${DEPLOY_REMOTES%% *}" ]; then
  log "repo update source: $ACTIVE_REMOTE (primary)"
else
  log "repo update source: $ACTIVE_REMOTE (fallback)"
fi

git -C "$REPO" fetch --quiet "$ACTIVE_REMOTE" "$BRANCH"
git -C "$REPO" reset --hard --quiet "$ACTIVE_REMOTE/$BRANCH"
