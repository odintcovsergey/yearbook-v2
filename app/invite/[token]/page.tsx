'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

type InvitationInfo = {
  email: string
  role: string
  tenant_name: string
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
}

export default function InvitePage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = params?.token

  const [info, setInfo] = useState<InvitationInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`/api/auth?action=invitation&token=${encodeURIComponent(token)}`)
      .then(async r => {
        if (r.ok) {
          const data = await r.json()
          setInfo(data)
        } else {
          const d = await r.json().catch(() => ({}))
          setLoadError(d.error ?? 'Не удалось загрузить приглашение')
        }
      })
      .catch(() => setLoadError('Ошибка сети'))
      .finally(() => setChecking(false))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!fullName.trim()) {
      setError('Укажите ваше имя')
      return
    }
    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов')
      return
    }
    if (password !== password2) {
      setError('Пароли не совпадают')
      return
    }

    setBusy(true)
    const r = await fetch('/api/auth', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'accept_invitation',
        token,
        password,
        full_name: fullName.trim(),
      }),
    })

    if (r.ok) {
      const data = await r.json()
      // Перенаправляем в зависимости от роли
      if (data.user?.role === 'superadmin') {
        router.push('/super')
      } else {
        router.push('/app')
      }
    } else {
      const d = await r.json().catch(() => ({}))
      setError(d.error ?? 'Не удалось создать аккаунт')
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Проверяем приглашение...</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="card max-w-md w-full p-8 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Приглашение недействительно
          </h1>
          <p className="text-sm text-gray-500 mb-6">{loadError}</p>
          <p className="text-xs text-gray-400">
            Попросите владельца команды отправить новое приглашение
            или войдите в свой существующий аккаунт.
          </p>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="btn-secondary text-sm mt-4"
          >
            Перейти к входу
          </button>
        </div>
      </div>
    )
  }

  if (!info) return null

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="card max-w-md w-full p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">
          Приглашение в команду
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Вас пригласили как{' '}
          <strong className="text-gray-900">
            {ROLE_LABELS[info.role] ?? info.role}
          </strong>
          {info.tenant_name && (
            <>
              {' '}в «<strong className="text-gray-900">{info.tenant_name}</strong>»
            </>
          )}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Email</label>
            <input
              type="email"
              value={info.email}
              disabled
              className="input w-full bg-gray-50 text-gray-500"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Ваше имя
            </label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Иван Иванов"
              className="input w-full"
              disabled={busy}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Пароль <span className="text-gray-400">(не короче 8 символов)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input w-full"
              disabled={busy}
              minLength={8}
              required
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Повторите пароль
            </label>
            <input
              type="password"
              value={password2}
              onChange={e => setPassword2(e.target.value)}
              className="input w-full"
              disabled={busy}
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? 'Создаём аккаунт...' : 'Принять приглашение'}
          </button>
        </form>

        <p className="text-xs text-gray-400 mt-6 text-center">
          Уже есть аккаунт?{' '}
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="text-gray-600 hover:text-gray-900 underline"
          >
            Войти
          </button>
        </p>
      </div>
    </div>
  )
}
