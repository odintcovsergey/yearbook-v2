'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type AuthData = {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  isLegacy?: boolean
}

export default function SuperPage() {
  const router = useRouter()
  const [data, setData] = useState<AuthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.authenticated || d.isLegacy) {
          router.push('/login')
          return
        }
        if (d.user?.role !== 'superadmin') {
          router.push('/app')
          return
        }
        setData(d)
        setLoading(false)
      })
      .catch(() => router.push('/login'))
  }, [router])

  const handleLogout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'logout' }),
    })
    router.push('/login')
  }

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1
              className="text-xl font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Панель суперадминистратора
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {data.user?.full_name}
            </p>
          </div>
          <button onClick={handleLogout} className="btn-secondary">
            Выйти
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="card p-8">
          <h2 className="text-lg font-semibold mb-2">Вход выполнен ✓</h2>
          <p className="text-sm text-gray-500 mb-6">
            Вы вошли как суперадминистратор через новую систему авторизации (JWT).
            Текущая админка продолжает работать параллельно.
          </p>
          <div className="flex gap-3">
            <a href="/admin" className="btn-primary">
              Старая админка
            </a>
          </div>
        </div>

        <div className="card p-8 mt-6">
          <h3 className="font-medium mb-3">Дальнейшие этапы разработки</h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li>• Список всех арендаторов (tenants)</li>
            <li>• Создание нового арендатора + пригласительная ссылка</li>
            <li>• Вход от имени арендатора для поддержки</li>
            <li>• Глобальная статистика по всем аккаунтам</li>
            <li>• Управление тарифными планами</li>
          </ul>
        </div>
      </main>
    </div>
  )
}
