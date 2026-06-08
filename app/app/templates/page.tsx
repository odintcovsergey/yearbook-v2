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
 * РЭ.28.4: дизайны разделены на два раздела — «Глобальные шаблоны OkeyBook»
 * и «Мои дизайны». На глобальных карточках — кнопка «Создать на основе...»
 * (в 28.4 — заглушка, реальная модалка приедет в 28.5). На карточках
 * своих дизайнов — кнопка «Удалить» (с confirm + API template_set_delete).
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Package, Folder } from 'lucide-react'
import { CloneTemplateSetModal } from './_components/CloneTemplateSetModal'
import { api } from '@/lib/api-client'

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

// api() с auto-refresh теперь импортируется из @/lib/api-client.

export default function DesignsListPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [designs, setDesigns] = useState<Design[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // РЭ.28.4: отдельный state для пользователя действий (удаление)
  // чтобы блокировать кнопки во время запроса.
  const [actionTsId, setActionTsId] = useState<string | null>(null)
  // РЭ.28.5: source-дизайн для открытой модалки клонирования.
  // null = модалка закрыта.
  const [cloneSource, setCloneSource] = useState<Design | null>(null)

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

  // РЭ.28.5: открываем модалку с source-дизайном.
  // Раньше (РЭ.28.4) тут был alert-заглушка.
  const handleCloneClick = useCallback((design: Design) => {
    setCloneSource(design)
  }, [])

  // РЭ.28.5: после успешного создания клона — закрываем модалку,
  // перезагружаем список и можем перейти к новому дизайну (опционально
  // — пока остаёмся в списке, партнёр сам решит).
  const handleCloneSuccess = useCallback(
    async (newTsId: string) => {
      setCloneSource(null)
      await loadDesigns()
      // eslint-disable-next-line no-console
      console.info('[clone] created new template_set:', newTsId)
    },
    [loadDesigns],
  )

  // РЭ.28.4: удаление своего дизайна. Confirm + API template_set_delete.
  const handleDeleteClick = useCallback(
    async (design: Design) => {
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        `Удалить дизайн «${design.name}»?\n\n` +
          `Это действие необратимо. Если дизайн используется в альбомах ` +
          `или пресетах — удалить не получится.`,
      )
      if (!ok) return

      setActionTsId(design.id)
      setError(null)
      try {
        const r = await api('/api/tenant', {
          method: 'POST',
          body: JSON.stringify({
            action: 'template_set_delete',
            template_set_id: design.id,
          }),
        })
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          // 409: дизайн используется. Показываем сообщение из API.
          if (r.status === 409) {
            throw new Error(d.error ?? 'Дизайн используется')
          }
          throw new Error(d.error ?? `HTTP ${r.status}`)
        }
        await loadDesigns()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Ошибка удаления')
      } finally {
        setActionTsId(null)
      }
    },
    [loadDesigns],
  )

  if (!authChecked) return null

  // РЭ.28.4: разделение на глобальные и мои.
  // tenant_id IS NULL → глобальный, иначе — мой.
  // Используем поле is_global (из API designs_list) — оно дублирует
  // tenant_id IS NULL и проще читается.
  const globalDesigns = designs.filter((d) => d.is_global)
  const myDesigns = designs.filter((d) => !d.is_global)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-gray-400 mb-1">
              <button
                onClick={() => router.push('/app')}
                className="hover:text-gray-700"
              >
                Главная
              </button>
              {' / '}
              <span>Шаблоны</span>
            </div>
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

        {/* РЭ.28.4: Раздел «Мои дизайны» — показываем только если есть клоны. */}
        {myDesigns.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              Мои дизайны
              <span className="text-sm font-normal text-gray-500 ml-2">
                ({myDesigns.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {myDesigns.map((d) => (
                <DesignCard
                  key={d.id}
                  design={d}
                  onOpen={() => router.push(`/app/templates/${d.id}`)}
                  onClone={null}
                  onDelete={() => handleDeleteClick(d)}
                  deleting={actionTsId === d.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* РЭ.28.4: Раздел «Глобальные шаблоны OkeyBook». */}
        {globalDesigns.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              {myDesigns.length > 0 ? 'Глобальные шаблоны OkeyBook' : 'Доступные дизайны'}
              <span className="text-sm font-normal text-gray-500 ml-2">
                ({globalDesigns.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {globalDesigns.map((d) => (
                <DesignCard
                  key={d.id}
                  design={d}
                  onOpen={() => router.push(`/app/templates/${d.id}`)}
                  onClone={() => handleCloneClick(d)}
                  onDelete={null}
                  deleting={false}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* РЭ.28.5: модалка клонирования. Рендерится поверх — fixed inset-0. */}
      {cloneSource && (
        <CloneTemplateSetModal
          source={{
            id: cloneSource.id,
            name: cloneSource.name,
            page_width_mm: cloneSource.page_width_mm,
            page_height_mm: cloneSource.page_height_mm,
          }}
          sourceBleedMm={null}
          onClose={() => setCloneSource(null)}
          onSuccess={handleCloneSuccess}
        />
      )}
    </div>
  )
}

function DesignCard({
  design,
  onOpen,
  onClone,
  onDelete,
  deleting,
}: {
  design: Design
  onOpen: () => void
  /** Кнопка «Создать на основе...» — null для своих дизайнов. */
  onClone: (() => void) | null
  /** Кнопка «Удалить» — null для глобальных дизайнов. */
  onDelete: (() => void) | null
  deleting: boolean
}) {
  const hasPreviews = design.previews.length > 0

  return (
    <div className="bg-white border border-gray-200/70 rounded-2xl p-5 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 hover:border-brand-300 transition-all duration-150 flex flex-col">
      {/* Превью — клик открывает дизайн */}
      <button
        type="button"
        onClick={onOpen}
        className="text-left mb-3 cursor-pointer"
      >
        {hasPreviews ? (
          <div className="grid grid-cols-3 gap-2">
            {design.previews.map((svg, i) => (
              <div
                key={i}
                className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden flex items-center justify-center"
                style={{ aspectRatio: '1 / 1.4', minHeight: '90px' }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ))}
            {/* Заполнители если меньше 3 превью */}
            {Array.from({ length: 3 - design.previews.length }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="bg-gray-50 border border-dashed border-gray-200 rounded-lg"
                style={{ aspectRatio: '1 / 1.4', minHeight: '90px' }}
              />
            ))}
          </div>
        ) : (
          <div
            className="bg-gray-50 border border-dashed border-gray-200 rounded-lg flex items-center justify-center text-gray-400 text-xs"
            style={{ aspectRatio: '3 / 1.4', minHeight: '90px' }}
          >
            Нет превью мастеров
          </div>
        )}
      </button>

      {/* Название — тоже клик-зона */}
      <button
        type="button"
        onClick={onOpen}
        className="font-semibold text-gray-900 truncate text-left hover:text-brand-700"
        title={design.name}
      >
        {design.name}
      </button>

      {/* Размеры (РЭ.28.4): полезно при выборе для клонирования */}
      {design.page_width_mm && design.page_height_mm && (
        <div className="text-xs text-gray-500 mt-1">
          {Math.round(design.page_width_mm)}×{Math.round(design.page_height_mm)} мм
        </div>
      )}

      {/* Бейджи */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {design.is_global ? (
          <span className="px-2.5 py-0.5 bg-brand-50 text-brand-700 text-xs font-medium rounded-full">
            от OkeyBook
          </span>
        ) : (
          <span className="px-2.5 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
            мой дизайн
          </span>
        )}
        {design.print_type === 'layflat' && (
          <span className="px-2.5 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
            твёрдая обложка
          </span>
        )}
        {design.print_type === 'soft' && (
          <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
            мягкая обложка
          </span>
        )}
      </div>

      {/* Счётчики */}
      <div className="text-xs text-gray-500 mt-3 flex items-center gap-1.5 flex-wrap">
        {design.recommended_count > 0 && (
          <span className="inline-flex items-center gap-1"><Package size={13} /> {design.recommended_count} готовых от OkeyBook</span>
        )}
        {design.recommended_count > 0 && design.my_count > 0 && <span className="text-gray-300">·</span>}
        {design.my_count > 0 && (
          <span className="inline-flex items-center gap-1"><Folder size={13} /> {design.my_count} моих шаблонов</span>
        )}
        {design.recommended_count === 0 && design.my_count === 0 && (
          <span className="text-gray-400">пока шаблонов нет — можно создать свой</span>
        )}
      </div>

      {/* Кнопки действий */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onOpen}
          className="text-brand-600 text-sm font-medium hover:text-brand-700"
        >
          Открыть →
        </button>

        {/* РЭ.28.4: «Создать на основе...» — только для глобальных */}
        {onClone && (
          <button
            type="button"
            onClick={onClone}
            className="ml-auto px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-lg border border-gray-200"
            title="Скопировать этот дизайн с изменёнными размерами"
          >
            Создать на основе…
          </button>
        )}

        {/* РЭ.28.4: «Удалить» — только для своих */}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="ml-auto px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-xs rounded-lg border border-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? 'Удаление...' : 'Удалить'}
          </button>
        )}
      </div>
    </div>
  )
}
