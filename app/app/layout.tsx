/**
 * Layout кабинета (app/app/**). Подключает тёмную тему ТОЛЬКО для кабинета:
 * родительские/публичные/партнёрские страницы вне этого layout остаются светлыми.
 *
 * Анти-FOUC: инлайн-скрипт выставляет класс `.dark` на <html> ДО первого
 * рендера (читает выбор из localStorage / системную тему), чтобы не было
 * вспышки светлой темы при загрузке. По умолчанию — светлая (решение Сергея).
 */

import { ThemeProvider } from './_components/ThemeProvider'

const themeInitScript = `
(function(){try{
  var t = localStorage.getItem('okeybook-theme') || 'light';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}catch(e){}})();
`

export default function CabinetLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <ThemeProvider>{children}</ThemeProvider>
    </>
  )
}
