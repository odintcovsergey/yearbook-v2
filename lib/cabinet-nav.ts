/**
 * cabinet-nav — мостик «sidebar → модалки кабинета».
 *
 * Модалки (Пресеты, Цитаты, Партнёры, CRM, Команда, Идеи, Настройки) живут в
 * app/app/page.tsx и завязаны на её состояние/хелперы. Sidebar же общий и стоит
 * в layout (на всех /app/*). Чтобы открыть модалку из sidebar, не вытаскивая её
 * из page.tsx, используем простой pub/sub:
 *
 *  - sidebar зовёт requestModal('crm');
 *  - page.tsx (когда смонтирована на /app) подписана и открывает нужную модалку;
 *  - если page.tsx ещё не смонтирована (мы на /app/templates) — запрос кладётся
 *    в pending, sidebar делает router.push('/app'), а page.tsx заберёт pending
 *    при монтировании.
 *
 * Модуль-синглтон переживает клиентскую навигацию (тот же JS-контекст).
 */

export type CabinetModalKey =
  | 'quotes'
  | 'partners'
  | 'crm'
  | 'team'
  | 'ideas'
  | 'settings'

let pending: CabinetModalKey | null = null
const listeners = new Set<(key: CabinetModalKey) => void>()

export function requestModal(key: CabinetModalKey) {
  if (listeners.size > 0) {
    listeners.forEach((l) => l(key))
  } else {
    // page.tsx ещё не смонтирована — заберёт при подписке
    pending = key
  }
}

export function subscribeModal(listener: (key: CabinetModalKey) => void): () => void {
  listeners.add(listener)
  if (pending !== null) {
    const p = pending
    pending = null
    listener(p)
  }
  return () => {
    listeners.delete(listener)
  }
}
