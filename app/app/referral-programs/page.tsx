'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ReferralProgramsManager from '@/app/_components/ReferralProgramsManager'

type AuthData = {
  authenticated: boolean
  user?: { role: string }
  isLegacy?: boolean
}

// Кабинет партнёра: свои реферальные программы + готовые (глобальные от
// OkeyBook, read-only). Бэкенд /api/referral-programs скоупит по tenant.
export default function PartnerReferralProgramsPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [canManage, setCanManage] = useState(false)

  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) { router.push('/login'); return }
        // viewer не управляет настройками — пускаем только owner/manager/superadmin.
        const role = d.user?.role
        setCanManage(role === 'owner' || role === 'manager' || role === 'superadmin')
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Проверка авторизации…</div>
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        <button onClick={() => router.push('/app')} className="text-sm text-muted-foreground hover:text-muted-foreground mb-2">← В кабинет</button>
        <h1 className="text-2xl font-semibold mb-1">🎁 Реферальные программы</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Готовые программы от OkeyBook можно «Дублировать себе» и доработать, либо создать свою.
          Награды применяются вручную — система показывает их родителям и ведёт учёт, кто кого привёл.
          Назначается программа альбому в его настройках (шестерёнка).
        </p>
        {canManage ? (
          <ReferralProgramsManager apiBase="/api/referral-programs" />
        ) : (
          <div className="text-center text-muted-foreground py-12">
            Управление программами доступно владельцу и менеджерам кабинета.
          </div>
        )}
      </div>
    </div>
  )
}
