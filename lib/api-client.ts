/**
 * Общий fetch-клиент с auto-refresh JWT.
 *
 * Зачем: access-token живёт 15 минут (см. ACCESS_TOKEN_TTL в lib/auth.ts).
 * Refresh-token живёт 30 дней. Когда access протух, любой запрос отдаёт
 * 401 «Необходима авторизация». До этого модуля каждая страница
 * реализовывала auto-refresh у себя локально — три страницы это делали
 * (page.tsx, /app/album/[id]/layout, /app/templates/[designId]), а
 * остальные нет. Из-за этого партнёр на «не-обновляемых» страницах
 * получал силент-401 после 15 минут простоя и думал что система
 * «вылетает».
 *
 * Сейчас все клиентские страницы должны импортировать `api` или
 * `apiPost` отсюда — refresh-логика реализована один раз.
 *
 * ПАТТЕРН ИСПОЛЬЗОВАНИЯ:
 *   import { api } from '@/lib/api-client'
 *   const res = await api('/api/tenant', {
 *     method: 'POST',
 *     body: JSON.stringify({ action: 'whatever' }),
 *   })
 *
 * Module-level флаг _refreshing предотвращает race: если 5 параллельных
 * запросов получили 401, все они дождутся одного refresh.
 */

let _refreshing: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (_refreshing) return _refreshing
  _refreshing = fetch('/api/auth', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'refresh' }),
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      _refreshing = null
    })
  return _refreshing
}

/**
 * Базовый fetch-обёрткой. При 401 пытается refresh + повторить запрос.
 * Если refresh тоже не удался (refresh-token истёк или украден) —
 * возвращает оригинальный 401-response. UI/вызывающий код должен
 * обработать 401 (обычно — редирект на /login).
 */
export async function api(
  path: string,
  opts?: RequestInit,
): Promise<Response> {
  const res = await fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })
  if (res.status === 401) {
    const ok = await refreshAccessToken()
    if (ok) {
      return fetch(path, {
        ...opts,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...opts?.headers },
      })
    }
  }
  return res
}
