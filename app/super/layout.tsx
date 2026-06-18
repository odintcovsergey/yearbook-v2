/**
 * Layout супер-панели (app/super/**). Та же тёмная тема, что и в кабинете
 * (territory владельца). Провайдер и переключатель переиспользуются из
 * app/app/_components. Выбор темы общий (localStorage 'okeybook-theme').
 *
 * Анти-FOUC: инлайн-скрипт ставит `.dark` на <html> до рендера. Дефолт — светлая.
 */

import { cookies } from 'next/headers'
import { ThemeProvider } from '../app/_components/ThemeProvider'
import { SuperShell } from './_components/SuperShell'

const themeInitScript = `
(function(){try{
  var t = localStorage.getItem('okeybook-theme') || 'light';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}catch(e){}})();
`

export default function SuperLayout({ children }: { children: React.ReactNode }) {
  const collapsed = cookies().get('super_sidebar_collapsed')?.value === '1'
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <ThemeProvider>
        <SuperShell initialCollapsed={collapsed}>{children}</SuperShell>
      </ThemeProvider>
    </>
  )
}
