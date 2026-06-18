/**
 * super-nav — мостик «sidebar супер-панели → вкладки /super/page.tsx».
 *
 * Главная страница супер-панели имеет внутренние вкладки (Арендаторы/Партнёры/
 * Очередь работ) на состоянии superTab. Боковое меню стоит в layout (общее для
 * всех /super/*), поэтому переключение этих вкладок и подсветка активной идут
 * через простой pub/sub (как cabinet-nav, плюс канал «активная вкладка» и
 * «бейджи», чтобы меню показывало текущую вкладку и счётчики).
 *
 * Модуль-синглтон переживает клиентскую навигацию.
 */

export type SuperTab = 'tenants' | 'partners' | 'queue'

export interface SuperBadges {
  queueNew: number
  ideasPending: number
}

// --- sidebar → page: запрос переключить вкладку ---
let pendingTab: SuperTab | null = null
const tabReqListeners = new Set<(t: SuperTab) => void>()

export function requestSuperTab(tab: SuperTab) {
  if (tabReqListeners.size > 0) tabReqListeners.forEach((l) => l(tab))
  else pendingTab = tab
}

export function subscribeSuperTabRequest(l: (t: SuperTab) => void): () => void {
  tabReqListeners.add(l)
  if (pendingTab !== null) {
    const p = pendingTab
    pendingTab = null
    l(p)
  }
  return () => { tabReqListeners.delete(l) }
}

// --- page → sidebar: какая вкладка сейчас активна (для подсветки) ---
let activeTab: SuperTab = 'tenants'
const activeListeners = new Set<(t: SuperTab) => void>()

export function setActiveSuperTab(tab: SuperTab) {
  activeTab = tab
  activeListeners.forEach((l) => l(tab))
}

export function subscribeActiveSuperTab(l: (t: SuperTab) => void): () => void {
  activeListeners.add(l)
  l(activeTab)
  return () => { activeListeners.delete(l) }
}

// --- page → sidebar: бейджи (новые работы / идеи на модерации) ---
let badges: SuperBadges = { queueNew: 0, ideasPending: 0 }
const badgeListeners = new Set<(b: SuperBadges) => void>()

export function setSuperBadges(b: SuperBadges) {
  badges = b
  badgeListeners.forEach((l) => l(b))
}

export function subscribeSuperBadges(l: (b: SuperBadges) => void): () => void {
  badgeListeners.add(l)
  l(badges)
  return () => { badgeListeners.delete(l) }
}
