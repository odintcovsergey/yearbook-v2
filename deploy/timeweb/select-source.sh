#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Общая логика выбора git-источника для pull-деплоя yearbook-v2.
#
# Источники в порядке приоритета (override через DEPLOY_REMOTES):
#   primary  = gitflic — росхостинг, стабилен с РФ-сервера;
#   fallback = origin   — github, периодически флапает по SSL из РФ.
# Активным становится ПЕРВЫЙ источник, на котором `git ls-remote --exit-code`
# ответил за DEPLOY_PROBE_TIMEOUT. Если ни один не ответил — функция вернёт 1
# (вызывающий обязан честно упасть, а не деплоить молча со старого состояния).
#
# Использование (после того как заданы $REPO и $BRANCH):
#   source "$SCRIPT_DIR/select-source.sh"
#   ACTIVE_REMOTE="$(select_active_remote "$BRANCH")" || { log "нет источника"; exit 1; }
#
# Это ТОЛЬКО библиотека (sourced) — сама ничего не выполняет.
# ─────────────────────────────────────────────────────────────────────────────

# Порядок приоритета источников. Первый = primary.
DEPLOY_REMOTES="${DEPLOY_REMOTES:-gitflic origin}"
# Таймаут одной проверки доступности источника (сек).
DEPLOY_PROBE_TIMEOUT="${DEPLOY_PROBE_TIMEOUT:-15}"

# Возвращает имя/URL первого доступного источника в stdout (код 0),
# или код 1, если ни один не ответил. $REPO и $BRANCH должны быть заданы.
select_active_remote() {
  local branch="${1:-main}" r
  for r in $DEPLOY_REMOTES; do
    if GIT_TERMINAL_PROMPT=0 timeout "$DEPLOY_PROBE_TIMEOUT" \
         git -C "$REPO" ls-remote --exit-code "$r" "$branch" >/dev/null 2>&1; then
      printf '%s' "$r"
      return 0
    fi
  done
  return 1
}
