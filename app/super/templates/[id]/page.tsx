'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import type { TemplateSetDetailResponse } from '../_components/types'

type AuthData = {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  isLegacy?: boolean
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

type LoadError = { kind: 'notfound' | 'badrequest' | 'network'; message: string }

export default function TemplateDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [authChecked, setAuthChecked] = useState(false)
  const [data, setData] = useState<TemplateSetDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<LoadError | null>(null)

  useEffect(() => {
    api('/api/auth')
      .then(r => r.ok ? r.json() : null)
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) { router.push('/login'); return }
        if (d.user?.role !== 'superadmin') { router.push('/app'); return }
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const r = await api(`/api/layout?action=template_set_detail&id=${id}`)
      if (r.status === 404) {
        setError({ kind: 'notfound', message: 'Шаблон не найден или нет доступа' })
        return
      }
      if (r.status === 400) {
        const d = await r.json().catch(() => ({}))
        setError({ kind: 'badrequest', message: d.error ?? 'Некорректный запрос' })
        return
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      setData((await r.json()) as TemplateSetDetailResponse)
    } catch (e) {
      setError({
        kind: 'network',
        message: e instanceof Error ? e.message : 'Ошибка сети',
      })
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (authChecked) loadDetail()
  }, [authChecked, loadDetail])

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Проверка авторизации…
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => router.push('/super/templates')}
            className="btn-secondary mb-4"
          >
            ← К списку шаблонов
          </button>

          {data && (
            <>
              <h1 className="text-2xl font-semibold mb-1">{data.template_set.name}</h1>
              <p className="text-sm text-gray-500">
                <code>{data.template_set.slug}</code>
                {' · '}
                {Math.round(data.template_set.page_width_mm)} × {Math.round(data.template_set.page_height_mm)} mm
                {' · '}
                {data.spread_templates.length} разворотов
              </p>
            </>
          )}
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-400">Загрузка…</div>
        )}

        {error && !loading && (
          <div className="card p-6 text-center">
            <div className="text-red-600 mb-3">{error.message}</div>
            {error.kind !== 'notfound' && (
              <button onClick={loadDetail} className="btn-secondary">Повторить</button>
            )}
          </div>
        )}

        {!loading && !error && data && data.spread_templates.length === 0 && (
          <div className="card p-12 text-center text-gray-500">
            В шаблоне нет ни одного разворота.
          </div>
        )}

        {!loading && !error && data && data.spread_templates.length > 0 && (
          <div className="card p-4">
            <ul className="divide-y divide-gray-100">
              {data.spread_templates.map(s => (
                <li
                  key={s.id}
                  className="py-2 flex items-center gap-3 text-sm"
                >
                  <span className="text-gray-400 w-8 text-right tabular-nums">
                    {s.sort_order}.
                  </span>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-gray-500">({s.type})</span>
                  {s.is_spread && (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-600">
                      spread
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-400 tabular-nums">
                    {s.width_mm.toFixed(0)} × {s.height_mm.toFixed(0)} mm
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
