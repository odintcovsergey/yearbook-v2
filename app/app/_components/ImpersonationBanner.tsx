'use client'

/**
 * ImpersonationBanner — постоянная полоса сверху кабинета, когда сотрудник
 * OkeyBook работает «как партнёр» (активен imp_token). Видна во ВСЁМ /app
 * (подключена в layout). Когда impersonation не активна — рендерит null.
 *
 * Заметный цвет (янтарный), чтобы менеджер не забыл, в чьём кабинете он
 * находится. Кнопка «Выйти из кабинета» удаляет imp-сессию и возвращает
 * менеджера в кабинет OkeyBook.
 */

import { useEffect, useState, useCallback } from 'react'
import { setImpersonationPartner } from '@/lib/impersonation-client'

interface ImpState {
  impersonating: boolean
  partnerName: string
  managerName: string
}

export function ImpersonationBanner() {
  const [state, setState] = useState<ImpState | null>(null)
  const [leaving, setLeaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      let res = await fetch('/api/auth', { credentials: 'include' })
      // imp-токен мог протухнуть → 401; пробуем продлить и перечитать.
      if (res.status === 401) {
        await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'refresh' }),
          credentials: 'include',
        })
        res = await fetch('/api/auth', { credentials: 'include' })
      }
      if (!res.ok) { setState(null); setImpersonationPartner(null); return }
      const d = await res.json()
      if (d?.impersonating) {
        const partnerName = d.tenant?.name ?? 'партнёр'
        setState({
          impersonating: true,
          partnerName,
          managerName: d.actingUser?.full_name ?? 'менеджер',
        })
        // делимся состоянием с confirmDestructive (доп-стоп на удаление)
        setImpersonationPartner(partnerName)
      } else {
        setState(null)
        setImpersonationPartner(null)
      }
    } catch {
      setState(null)
      setImpersonationPartner(null)
    }
  }, [])

  useEffect(() => {
    refresh()
    // Перечитываем при возврате фокуса на вкладку (imp мог продлиться/истечь).
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const handleLeave = async () => {
    setLeaving(true)
    try {
      await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'impersonate_stop' }),
        credentials: 'include',
      })
    } finally {
      // Полная перезагрузка — контекст определяется cookie на сервере.
      window.location.href = '/app'
    }
  }

  if (!state?.impersonating) return null

  return (
    <div className="w-full bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-center gap-3 text-sm font-medium shadow-md relative z-[60]">
      <span className="text-base leading-none">👤</span>
      <span>
        Вы в кабинете партнёра <b>«{state.partnerName}»</b> как менеджер <b>{state.managerName}</b>.
        Все действия логируются.
      </span>
      <button
        onClick={handleLeave}
        disabled={leaving}
        className="ml-2 bg-amber-950 text-amber-50 rounded-lg px-3 py-1 text-xs font-semibold hover:bg-amber-900 disabled:opacity-60 transition-colors"
      >
        {leaving ? 'Выходим…' : 'Выйти из кабинета'}
      </button>
    </div>
  )
}
