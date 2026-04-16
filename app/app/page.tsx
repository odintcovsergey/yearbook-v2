'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type AuthData = {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  tenant?: { id: string; name: string; slug: string; plan: string } | null
  isLegacy?: boolean
}

export default function AppPage() {
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
        // Superadmin должен идти в /super
        if (d.user?.role === 'superadmin') {
          router.push('/super')
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
              {data.tenant?.name ?? 'OkeyBook'}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {data.user?.full_name} · {data.user?.role}
            </p>
          </div>
          <button onClick={handleLogout} className="btn-secondary">
            Выйти
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="card p-8">
          <h2 className="text-lg font-semibold mb-2">Кабинет в разработке</h2>
          <p className="text-sm text-gray-500 mb-6">
            Функционал кабинета владельца/менеджера скоро появится.
            Сейчас для управления альбомами используйте старую админку.
          </p>
          <a href="/admin" className="btn-primary">
            Перейти в старую админку
          </a>
        </div>
      </main>
    </div>
  )
}
