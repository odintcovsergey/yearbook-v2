'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // Проверяем, не залогинен ли уже пользователь — тогда редиректим
  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.authenticated && !data.isLegacy) {
          // Уже залогинен — редирект в зависимости от роли
          if (data.user?.role === 'superadmin') {
            router.push('/super')
          } else {
            router.push('/app')
          }
        } else {
          setChecking(false)
        }
      })
      .catch(() => setChecking(false))
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'login', email, password }),
      })

      const data = await r.json()

      if (!r.ok) {
        setError(data.error ?? 'Ошибка входа')
        setLoading(false)
        return
      }

      // Успешный вход — редирект по роли
      if (data.user.role === 'superadmin') {
        router.push('/super')
      } else {
        router.push('/app')
      }
    } catch (err) {
      setError('Не удалось связаться с сервером')
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Проверка сессии...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-semibold text-gray-900 mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            OkeyBook
          </h1>
          <p className="text-sm text-gray-500">Вход в кабинет</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="name@example.com"
                autoComplete="email"
                autoFocus
                required
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Пароль
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full py-3"
              disabled={loading || !email || !password}
            >
              {loading ? 'Входим...' : 'Войти'}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center text-xs text-gray-400">
          <a href="/privacy" className="hover:text-gray-600 transition-colors">
            Политика конфиденциальности
          </a>
        </div>
      </div>
    </div>
  )
}
