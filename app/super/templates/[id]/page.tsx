'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useParams } from 'next/navigation'
import type { TemplateSetDetailResponse, SpreadTemplate } from '../_components/types'
import { PLACEHOLDER_COLORS } from '../_components/colors'

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

const SpreadCanvas = dynamic(
  () => import('../_components/SpreadCanvas'),
  { ssr: false, loading: () => <div className="text-gray-400 text-sm">Загрузка canvas…</div> },
)
const SpreadDetailModal = dynamic(
  () => import('../_components/SpreadDetailModal'),
  { ssr: false },
)

export default function TemplateDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [authChecked, setAuthChecked] = useState(false)
  const [data, setData] = useState<TemplateSetDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<LoadError | null>(null)
  const [selectedSpread, setSelectedSpread] = useState<SpreadTemplate | null>(null)

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
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-600">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded"
                    style={{ background: PLACEHOLDER_COLORS.photo.stroke }}
                  />
                  photo
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded"
                    style={{ background: PLACEHOLDER_COLORS.text.stroke }}
                  />
                  text
                </span>
              </div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.spread_templates.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSpread(s)}
                className="card p-3 text-left hover:shadow-md transition-shadow"
              >
                <SpreadCanvas
                  spread={s}
                  containerWidth={250}
                  listening={false}
                  pixelRatio={1}
                />
                <div className="mt-2 text-xs">
                  <div className="text-gray-400 tabular-nums">{s.sort_order}.</div>
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-gray-500">
                    ({s.type})
                    {s.is_spread && ' · spread'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedSpread && (
        <SpreadDetailModal
          spread={selectedSpread}
          onClose={() => setSelectedSpread(null)}
        />
      )}
    </div>
  )
}
