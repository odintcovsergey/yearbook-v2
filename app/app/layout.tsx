/**
 * Layout кабинета (app/app/**). Подключает тёмную тему ТОЛЬКО для кабинета:
 * родительские/публичные/партнёрские страницы вне этого layout остаются светлыми.
 *
 * Анти-FOUC: инлайн-скрипт выставляет класс `.dark` на <html> ДО первого
 * рендера (читает выбор из localStorage / системную тему), чтобы не было
 * вспышки светлой темы при загрузке. По умолчанию — светлая (решение Сергея).
 */

import { cookies } from 'next/headers'
import { ThemeProvider } from './_components/ThemeProvider'
import { CabinetShell } from './_components/CabinetShell'

const themeInitScript = `
(function(){try{
  var t = localStorage.getItem('okeybook-theme') || 'light';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}catch(e){}})();
`

export default function CabinetLayout({ children }: { children: React.ReactNode }) {
  // Состояние свёрнутости меню читаем из cookie на сервере, чтобы не было
  // вспышки (меню сразу нужной ширины). cookies() переводит /app в динамический
  // рендер — для авторизованного кабинета это нормально.
  const collapsed = cookies().get('sidebar_collapsed')?.value === '1'
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <ThemeProvider>
        <CabinetShell initialCollapsed={collapsed}>{children}</CabinetShell>
      </ThemeProvider>
    </>
  )
}
