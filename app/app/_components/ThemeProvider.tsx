'use client'

/**
 * Тёмная тема кабинета (Путь А). Провайдер хранит выбор (light/dark/system) в
 * localStorage и вешает класс `.dark` на <html> — ТОЛЬКО пока пользователь в
 * кабинете (app/app/**). При уходе из кабинета (размонтирование) класс
 * снимается, чтобы родительские/публичные страницы оставались светлыми.
 *
 * Анти-FOUC: класс выставляется ещё инлайн-скриптом в app/app/layout.tsx до
 * первого рендера; здесь — синхронизация состояния и реакция на смену системной
 * темы при выборе «как в системе».
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'okeybook-theme'

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyDarkClass(theme: ThemeMode) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // По умолчанию — светлая (решение Сергея). Реальное значение читаем из
  // localStorage в эффекте, чтобы не разойтись с SSR.
  const [theme, setThemeState] = useState<ThemeMode>('light')

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null)
    const initial: ThemeMode = stored === 'dark' || stored === 'system' || stored === 'light'
      ? stored
      : 'light'
    setThemeState(initial)
    applyDarkClass(initial)

    // Уходим из кабинета → снимаем .dark (родительские страницы светлые).
    return () => { document.documentElement.classList.remove('dark') }
  }, [])

  // Реакция на смену системной темы, когда выбран режим «как в системе».
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyDarkClass('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
    applyDarkClass(t)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
