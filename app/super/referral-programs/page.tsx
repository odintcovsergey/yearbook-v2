'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Gift } from 'lucide-react'
import ReferralProgramsManager from '@/app/_components/ReferralProgramsManager'

type AuthData = {
  authenticated: boolean
  user?: { role: string }
  isLegacy?: boolean
}

export default function ReferralProgramsPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) { router.push('/login'); return }
        if (d.user?.role !== 'superadmin') { router.push('/app'); return }
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Проверка авторизации…</div>
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        <button onClick={() => router.push('/super')} className="text-sm text-gray-400 hover:text-gray-600 mb-2">← Назад</button>
        <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2"><Gift size={22} /> Реферальные программы</h1>
        <p className="text-sm text-gray-500 mb-6">
          Настраиваемые награды для реферера (кто рекомендует) и реферала (кто пришёл по ссылке).
          Награды применяются вручную — система показывает и ведёт учёт. Глобальные программы видят все партнёры.
        </p>
        <ReferralProgramsManager apiBase="/api/referral-programs" />
      </div>
    </div>
  )
}
