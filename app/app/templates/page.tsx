/**
 * РЭ.24.5b: страница выбора дизайна.
 * URL: /app/templates
 *
 * Партнёр видит большие карточки доступных дизайнов (template_set'ов).
 * У каждой карточки:
 *   • 3 мини-превью характерных мастеров этого дизайна
 *   • Название, бейдж глобальный/мой
 *   • Счётчики: «N готовых» (recommended-шаблонов от OkeyBook),
 *     «M моих шаблонов»
 *   • Кнопка «Открыть» → /app/templates/[designId]
 *
 * Сейчас в БД один template_set okeybook-default («белый, без фона»).
 * В планах ~20-30 дизайнов под садики и школы. Когда дизайн добавится
 * через /super (загрузка IDML) — он автоматически появится здесь.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Design {
  id: string
  name: string
  slug: string
  tenant_id: string | null
  is_global: boolean
  print_type: 'layflat' | 'soft' | null
  page_width_mm: number | null
  page_height_mm: number | null
  recommended_count: number
  my_count: number
  previews: string[] // до 3 SVG
}

interface AuthData {
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

export default function DesignsListPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [designs, setDesigns] = useState<Design[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Авторизация
  useEffect(() => {
    api('/api/auth')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) {
          router.push('/login')
          return
        }
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  const loadDesigns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api('/api/tenant?action=designs_list')
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      const data = await r.json()
      setDesigns(data.designs ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authChecked) loadDesigns()
  }, [authChecked, loadDesigns])

  if (!authChecked) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Дизайны и шаблоны</h1>
            <p className="text-sm text-gray-600 mt-1">
              Сначала выберите дизайн — общий стиль альбома (например
              «Сказочный для садиков» или «Школьный строгий»). Внутри
              дизайна — готовые шаблоны от OkeyBook и ваша личная
              библиотека настроек.
            </p>
          </div>
          <button
            onClick={() => router.push('/app')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← К альбомам
          </button>
        </div>

        {loading && <div className="text-gray-500 mb-4">Загрузка...</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {!loading && designs.length === 0 && (
          <div className="bg-white border border-gray-200 rounded p-6 text-center text-gray-500">
            Нет доступных дизайнов. Обратитесь в OkeyBook для подключения.
          </div>
        )}

        {/* Сетка дизайнов */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {designs.map((d) => (
            <DesignCard
              key={d.id}
              design={d}
              onOpen={() => router.push(`/app/templates/${d.id}`)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function DesignCard({ design, onOpen }: { design: Design; onOpen: () => void }) {
  const hasPreviews = design.previews.length > 0

  return (
    <button
      onClick={onOpen}
      className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-blue-300 transition-all text-left flex flex-col"
    >
      {/* Превью */}
      {hasPreviews ? (
        <div className="grid grid-cols-3 gap-1 mb-3">
          {design.previews.map((svg, i) => (
            <div
              key={i}
              className="bg-gray-50 border border-gray-200 rounded overflow-hidden flex items-center justify-center"
              style={{ aspectRatio: '1 / 1.4', minHeight: '70px' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ))}
          {/* Заполнители если меньше 3 превью */}
          {Array.from({ length: 3 - design.previews.length }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="bg-gray-50 border border-dashed border-gray-200 rounded"
              style={{ aspectRatio: '1 / 1.4', minHeight: '70px' }}
            />
          ))}
        </div>
      ) : (
        <div
          className="bg-gray-50 border border-dashed border-gray-200 rounded mb-3 flex items-center justify-center text-gray-400 text-xs"
          style={{ aspectRatio: '3 / 1.4', minHeight: '70px' }}
        >
          Нет превью мастеров
        </div>
      )}

      {/* Название */}
      <div className="font-semibold text-gray-900 truncate" title={design.name}>
        {design.name}
      </div>

      {/* Бейджи */}
      <div className="flex flex-wrap gap-1 mt-2">
        {design.is_global ? (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
            от OkeyBook
          </span>
        ) : (
          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
            мой дизайн
          </span>
        )}
        {design.print_type === 'layflat' && (
          <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">
            твёрдая обложка
          </span>
        )}
        {design.print_type === 'soft' && (
          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
            мягкая обложка
          </span>
        )}
      </div>

      {/* Счётчики */}
      <div className="text-xs text-gray-500 mt-3">
        {design.recommended_count > 0 && (
          <span>📦 {design.recommended_count} готовых от OkeyBook</span>
        )}
        {design.recommended_count > 0 && design.my_count > 0 && ' · '}
        {design.my_count > 0 && (
          <span>📂 {design.my_count} моих шаблонов</span>
        )}
        {design.recommended_count === 0 && design.my_count === 0 && (
          <span className="text-gray-400">пока шаблонов нет — можно создать свой</span>
        )}
      </div>

      {/* Стрелка-индикатор */}
      <div className="mt-3 text-blue-600 text-sm font-medium">
        Открыть →
      </div>
    </button>
  )
}
