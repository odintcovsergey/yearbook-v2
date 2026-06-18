/**
 * Клиентское состояние impersonation, общее для всего бандла кабинета /app.
 * Заполняется баннером (ImpersonationBanner — единственный, кто читает
 * /api/auth в layout) и читается confirmDestructive в любом месте кабинета.
 *
 * Зачем модуль-синглтон, а не React-контекст: confirmDestructive вызывается из
 * синхронных обработчиков клика (window.confirm) в разных деревьях компонентов,
 * включая редактор разворотов. Синглтон-флаг доступен везде без проброса.
 */

let partnerName: string | null = null

export function setImpersonationPartner(name: string | null) {
  partnerName = name
}

export function isImpersonating(): boolean {
  return partnerName !== null
}

/**
 * window.confirm с доп-предупреждением, когда сотрудник OkeyBook действует в
 * чужом (партнёрском) кабинете. Вне impersonation ведёт себя как обычный confirm.
 * Использовать для деструктивных действий (удаление/сброс данных).
 */
export function confirmDestructive(message: string): boolean {
  if (partnerName) {
    return window.confirm(
      `⚠️ Вы действуете в кабинете партнёра «${partnerName}».\n` +
      `Это изменит данные ПАРТНЁРА, а не ваши.\n\n` +
      message,
    )
  }
  return window.confirm(message)
}
