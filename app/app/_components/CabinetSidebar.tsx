'use client'

/**
 * CabinetSidebar — единое вертикальное меню кабинета (во всём /app).
 * Стоит в layout, поэтому общее для альбомов, шаблонов, дизайнов, рефералок и
 * редактора. Пункты двух видов:
 *   - роутовые (Альбомы/Шаблоны/Дизайны/Рефералки) → router.push + подсветка по pathname;
 *   - модальные (Пресеты/Цитаты/Партнёры/CRM/Команда/Идеи/Настройки) → requestModal()
 *     (см. lib/cabinet-nav); если мы не на /app, сначала переходим туда.
 *
 * Развёрнут по умолчанию (иконка + подпись). Кнопка сворачивает в иконки
 * (подпись → tooltip). Состояние сохраняется в cookie (читается серверным
 * layout — без вспышки) + localStorage. На узком экране — off-canvas с бургером.
 */

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  LayoutDashboard, Ruler, Palette, Quote, Gift,
  Camera, Contact, Users, Lightbulb, Settings, LogOut,
  PanelLeftClose, PanelLeftOpen, Menu, X,
} from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { requestModal, type CabinetModalKey } from '@/lib/cabinet-nav'

const roleLabels: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
}

type Item =
  | { key: string; label: string; icon: typeof Ruler; href: string }
  | { key: string; label: string; icon: typeof Ruler; modal: CabinetModalKey }

function writeCollapsed(v: boolean) {
  try {
    document.cookie = `sidebar_collapsed=${v ? '1' : '0'}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    window.localStorage.setItem('sidebar_collapsed', v ? '1' : '0')
  } catch { /* приватный режим — игнор */ }
}

export function CabinetSidebar({ initialCollapsed }: { initialCollapsed: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [auth, setAuth] = useState<{
    user?: { full_name?: string; role?: string }
    tenant?: { name?: string; slug?: string }
  } | null>(null)

  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.authenticated) setAuth(d) })
      .catch(() => { /* меню всё равно покажем */ })
  }, [])

  // Закрываем мобильное меню при смене маршрута.
  useEffect(() => { setMobileOpen(false) }, [pathname])

  const isMainTenant = auth?.tenant?.slug === 'main'
  const canManageTeam = auth?.user?.role === 'owner'

  const topItems: (Item | false)[] = [
    { key: 'albums', label: 'Альбомы', icon: LayoutDashboard, href: '/app' },
    { key: 'templates', label: 'Шаблоны', icon: Ruler, href: '/app/templates' },
    { key: 'designs', label: 'Дизайны', icon: Palette, href: '/app/designs' },
    { key: 'quotes', label: 'Цитаты', icon: Quote, modal: 'quotes' },
    { key: 'referrals', label: 'Рефералки', icon: Gift, href: '/app/referral-programs' },
    isMainTenant && { key: 'partners', label: 'Партнёры', icon: Camera, modal: 'partners' as const },
    { key: 'crm', label: 'CRM', icon: Contact, modal: 'crm' },
    canManageTeam && { key: 'team', label: 'Команда', icon: Users, modal: 'team' as const },
    { key: 'ideas', label: 'Идеи', icon: Lightbulb, modal: 'ideas' },
  ]

  const isActiveRoute = (href: string) =>
    href === '/app' ? pathname === '/app' : pathname.startsWith(href)

  const handleItem = (item: Item) => {
    setMobileOpen(false)
    if ('href' in item) {
      router.push(item.href)
    } else {
      // requestModal сохранит запрос, если page.tsx ещё не смонтирована
      requestModal(item.modal)
      if (pathname !== '/app') router.push('/app')
    }
  }

  const toggleCollapse = () => {
    setCollapsed((c) => { writeCollapsed(!c); return !c })
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
        credentials: 'include',
      })
    } finally {
      router.push('/login')
    }
  }

  // Класс пункта меню. collapsed применяется только на md+ (на мобильном
  // off-canvas всегда показываем подписи).
  const itemCls = (active: boolean) =>
    `group flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? 'bg-muted text-brand-700 font-semibold'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    } ${collapsed ? 'md:justify-center md:px-0' : ''}`

  const labelCls = collapsed ? 'truncate md:hidden' : 'truncate'

  return (
    <>
      {/* Бургер на мобильном (когда меню закрыто) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-40 btn-secondary !p-2"
        aria-label="Меню"
      >
        <Menu size={18} />
      </button>

      {/* Подложка на мобильном */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`flex flex-col bg-card border-r border-border h-screen z-50 transition-[width,transform] duration-200 ease-in-out
          fixed inset-y-0 left-0 md:sticky md:top-0 md:z-30
          w-60 ${collapsed ? 'md:w-14' : 'md:w-60'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Шапка: бренд + пользователь + сворачивание */}
        <div className="border-b border-border px-2 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white font-bold">
              {(auth?.tenant?.name ?? 'O').charAt(0).toUpperCase()}
            </div>
            <div className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}>
              <div className="truncate font-semibold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                {auth?.tenant?.name ?? 'OkeyBook'}
              </div>
              {auth?.user && (
                <div className="truncate text-xs text-muted-foreground">
                  {auth.user.full_name} · {roleLabels[auth.user.role ?? ''] ?? auth.user.role}
                </div>
              )}
            </div>
            {/* Закрыть на мобильном */}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="md:hidden text-muted-foreground hover:text-foreground p-1"
              aria-label="Закрыть меню"
            >
              <X size={18} />
            </button>
            {/* Свернуть на десктопе (когда развёрнуто) */}
            {!collapsed && (
              <button
                type="button"
                onClick={toggleCollapse}
                className="hidden md:inline-flex text-muted-foreground hover:text-foreground p-1"
                title="Свернуть меню"
                aria-label="Свернуть меню"
              >
                <PanelLeftClose size={18} />
              </button>
            )}
          </div>
          {/* Развернуть на десктопе (когда свёрнуто) — отдельной строкой по центру */}
          {collapsed && (
            <button
              type="button"
              onClick={toggleCollapse}
              className="hidden md:flex mt-2 w-full justify-center text-muted-foreground hover:text-foreground p-1"
              title="Развернуть меню"
              aria-label="Развернуть меню"
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
        </div>

        {/* Пункты меню */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {topItems.filter(Boolean).map((item) => {
            const it = item as Item
            const active = 'href' in it && isActiveRoute(it.href)
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => handleItem(it)}
                className={itemCls(active)}
                title={collapsed ? it.label : undefined}
              >
                <it.icon size={18} className="shrink-0" />
                <span className={labelCls}>{it.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Низ: настройки, тема, выйти */}
        <div className="border-t border-border px-2 py-3 space-y-0.5">
          <button
            type="button"
            onClick={() => handleItem({ key: 'settings', label: 'Настройки', icon: Settings, modal: 'settings' })}
            className={itemCls(false)}
            title={collapsed ? 'Настройки' : undefined}
          >
            <Settings size={18} className="shrink-0" />
            <span className={labelCls}>Настройки</span>
          </button>

          <div className={`flex items-center gap-2 px-1 ${collapsed ? 'md:flex-col md:px-0' : ''}`}>
            <ThemeToggle />
            <button
              type="button"
              onClick={handleLogout}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${
                collapsed ? 'md:justify-center md:px-0 md:w-full' : 'flex-1'
              }`}
              title={collapsed ? 'Выйти' : undefined}
            >
              <LogOut size={18} className="shrink-0" />
              <span className={labelCls}>Выйти</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
