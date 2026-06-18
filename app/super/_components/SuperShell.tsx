'use client'

/**
 * SuperShell — каркас супер-панели: слева вертикальное меню (SuperSidebar),
 * справа рабочая зона. Каждая страница /super сохраняет свою внутреннюю обёртку
 * (min-h-screen), поэтому контент рендерим как есть.
 */

import { SuperSidebar } from './SuperSidebar'

export function SuperShell({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <SuperSidebar initialCollapsed={initialCollapsed} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
