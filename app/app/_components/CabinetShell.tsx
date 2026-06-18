'use client'

/**
 * CabinetShell — каркас кабинета: слева вертикальное меню (CabinetSidebar),
 * справа рабочая зона. impersonation-баннер живёт сверху рабочей зоны (НЕ в
 * меню), поэтому виден над контентом на всех экранах /app.
 *
 * Каждая страница /app сохраняет свою внутреннюю обёртку (min-h-screen / h-screen),
 * поэтому контент рендерим как есть — меню просто стоит слева как flex-сосед.
 */

import { CabinetSidebar } from './CabinetSidebar'
import { ImpersonationBanner } from './ImpersonationBanner'

export function CabinetShell({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <CabinetSidebar initialCollapsed={initialCollapsed} />
      <div className="flex-1 min-w-0 flex flex-col">
        <ImpersonationBanner />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}
