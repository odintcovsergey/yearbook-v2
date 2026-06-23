#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Health-check после переключения релиза. Проверяет ЛОКАЛЬНО (на сервере):
#   1. приложение поднялось:  GET 127.0.0.1:3000/login → 200
#   2. слой данных отвечает:  GET 127.0.0.1:3000/api/health → 200 {ok:true}
# Ждём прогрева до 30с (next start холодный старт). Любой провал → exit 1
# (deploy.sh откатит релиз). Внешний домен/HTTPS тут не проверяем — это nginx,
# на деплой приложения не влияет.
# ─────────────────────────────────────────────────────────────────────────────
set -u

PORT="${YB_PORT:-3000}"
BASE="http://127.0.0.1:$PORT"
ATTEMPTS="${YB_HC_ATTEMPTS:-15}"
SLEEP="${YB_HC_SLEEP:-2}"

probe() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || echo 000
}

# 1. /login → 200 (с ретраями на прогрев)
code=000
for _ in $(seq 1 "$ATTEMPTS"); do
  code="$(probe "$BASE/login")"
  [ "$code" = "200" ] && break
  sleep "$SLEEP"
done
if [ "$code" != "200" ]; then
  echo "health: /login вернул $code (ожидали 200)"
  exit 1
fi

# 2. /api/health → 200 (проба БД)
hcode="$(probe "$BASE/api/health")"
if [ "$hcode" != "200" ]; then
  echo "health: /api/health вернул $hcode (ожидали 200) — БД недоступна?"
  exit 1
fi

echo "health: OK (login=200, api/health=200)"
exit 0
