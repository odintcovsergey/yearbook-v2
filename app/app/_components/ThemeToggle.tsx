'use client'

/**
 * Переключатель темы в хедере кабинета. Три режима по кругу:
 * Светлая → Тёмная → Как в системе → Светлая. Иконка отражает текущий режим.
 */

import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type ThemeMode } from './ThemeProvider'

const NEXT: Record<ThemeMode, ThemeMode> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

const LABEL: Record<ThemeMode, string> = {
  light: 'Тема: светлая',
  dark: 'Тема: тёмная',
  system: 'Тема: как в системе',
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      className="btn-secondary !px-2.5"
      title={`${LABEL[theme]} — нажмите, чтобы сменить`}
      aria-label={LABEL[theme]}
    >
      {theme === 'light' && <Sun size={16} />}
      {theme === 'dark' && <Moon size={16} />}
      {theme === 'system' && <Monitor size={16} />}
    </button>
  )
}
