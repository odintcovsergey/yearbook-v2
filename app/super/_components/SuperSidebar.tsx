'use client'

/**
 * SuperSidebar — вертикальное меню супер-панели (во всём /super).
 * Стоит в layout, поэтому общее для главной, шаблонов, каталога мастеров,
 * пресетов, рефералок, обложек и идей. Пункты двух видов:
 *   - вкладки главной (Арендаторы/Партнёры/Очередь) → super-nav (requestSuperTab),
 *     с переходом на /super если мы на под-роуте; подсветка по активной вкладке;
 *   - роутовые (Шаблоны/Каталог мастеров/Пресеты/Рефералки/Обложки/Идеи) →
 *     router.push, подсветка по pathname.
 *
 * Поведение свёртки/мобильного — как в кабинете (CabinetSidebar): развёрнут по
 * умолчанию, cookie super_sidebar_collapsed, off-canvas на узком экране.
 */

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  Building2, Camera, Rocket, Ruler, LayoutGrid, LayoutTemplate,
  Gift, BookImage, Lightbulb, Printer, LogOut, PanelLeftClose, PanelLeftOpen, Menu, X,
} from 'lucide-react'
import { ThemeToggle } from '../../app/_components/ThemeToggle'
import {
  requestSuperTab, subscribeActiveSuperTab, subscribeSuperBadges,
  type SuperTab, type SuperBadges,
} from '@/lib/super-nav'

type TabItem = { kind: 'tab'; key: SuperTab; label: string; icon: typeof Ruler; badge?: 'queueNew' }
type RouteItem = { kind: 'route'; key: string; label: string; icon: typeof Ruler; href: string; badge?: 'ideasPending' }
type Item = TabItem | RouteItem

const ITEMS: Item[] = [
  { kind: 'tab', key: 'tenants', label: 'Арендаторы', icon: Building2 },
  { kind: 'tab', key: 'partners', label: 'Партнёры', icon: Camera },
  { kind: 'tab', key: 'queue', label: 'Очередь работ', icon: Rocket, badge: 'queueNew' },
  { kind: 'route', key: 'templates', label: 'Шаблоны', icon: Ruler, href: '/super/templates' },
  { kind: 'route', key: 'master-catalog', label: 'Каталог мастеров', icon: LayoutGrid, href: '/super/master-catalog' },
  { kind: 'route', key: 'presets', label: 'Пресеты', icon: LayoutTemplate, href: '/super/presets' },
  { kind: 'route', key: 'referrals', label: 'Реферальные программы', icon: Gift, href: '/super/referral-programs' },
  { kind: 'route', key: 'covers', label: 'Обложки', icon: BookImage, href: '/super/covers' },
  { kind: 'route', key: 'printers', label: 'Печать', icon: Printer, href: '/super/printers' },
  { kind: 'route', key: 'ideas', label: 'Идеи', icon: Lightbulb, href: '/super/ideas', badge: 'ideasPending' },
]

function writeCollapsed(v: boolean) {
  try {
    document.cookie = `super_sidebar_collapsed=${v ? '1' : '0'}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    window.localStorage.setItem('super_sidebar_collapsed', v ? '1' : '0')
  } catch { /* приватный режим — игнор */ }
}

export function SuperSidebar({ initialCollapsed }: { initialCollapsed: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SuperTab>('tenants')
  const [badges, setBadges] = useState<SuperBadges>({ queueNew: 0, ideasPending: 0 })
  const [me, setMe] = useState<{ full_name?: string; email?: string } | null>(null)

  useEffect(() => subscribeActiveSuperTab(setActiveTab), [])
  useEffect(() => subscribeSuperBadges(setBadges), [])
  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.authenticated) setMe(d.user) })
      .catch(() => { /* меню всё равно покажем */ })
  }, [])

  const onAtRoot = pathname === '/super'

  const isActive = (item: Item) =>
    item.kind === 'route'
      ? pathname.startsWith(item.href)
      : onAtRoot && activeTab === item.key

  const handleItem = (item: Item) => {
    setMobileOpen(false)
    if (item.kind === 'route') {
      router.push(item.href)
    } else {
      requestSuperTab(item.key)
      if (!onAtRoot) router.push('/super')
    }
  }

  const badgeValue = (item: Item): number => {
    if (item.badge === 'queueNew') return badges.queueNew
    if (item.badge === 'ideasPending') return badges.ideasPending
    return 0
  }

  const toggleCollapse = () => setCollapsed((c) => { writeCollapsed(!c); return !c })

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

  const itemCls = (active: boolean) =>
    `group flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? 'bg-muted text-brand-700 font-semibold'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    } ${collapsed ? 'md:justify-center md:px-0' : ''}`

  const labelCls = collapsed ? 'truncate md:hidden' : 'truncate'

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-40 btn-secondary !p-2"
        aria-label="Меню"
      >
        <Menu size={18} />
      </button>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`flex flex-col bg-card border-r border-border h-screen z-50 transition-[width,transform] duration-200 ease-in-out
          fixed inset-y-0 left-0 md:sticky md:top-0 md:z-30
          w-64 ${collapsed ? 'md:w-14' : 'md:w-64'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Шапка */}
        <div className="border-b border-border px-2 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white font-bold">
              O
            </div>
            <div className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}>
              <div className="truncate font-semibold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                Супер-админ
              </div>
              {me && (
                <div className="truncate text-xs text-muted-foreground">{me.full_name ?? me.email}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="md:hidden text-muted-foreground hover:text-foreground p-1"
              aria-label="Закрыть меню"
            >
              <X size={18} />
            </button>
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

        {/* Пункты */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {ITEMS.map((item) => {
            const active = isActive(item)
            const badge = badgeValue(item)
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleItem(item)}
                className={itemCls(active)}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={18} className="shrink-0" />
                <span className={labelCls}>{item.label}</span>
                {badge > 0 && (
                  <span
                    className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-xs font-semibold ${
                      collapsed ? 'md:hidden' : ''
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Низ: тема + выйти */}
        <div className="border-t border-border px-2 py-3">
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
