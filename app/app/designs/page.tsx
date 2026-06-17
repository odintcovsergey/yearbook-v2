/**
 * Страница «Дизайны» (развязка шаблон↔дизайн, 17.06.2026).
 * URL: /app/designs
 *
 * Дизайн (template_set) — это ВИЗУАЛЬНОЕ оформление альбома (набор IDML-
 * мастеров: фоны, рамки, декор). Здесь партнёр:
 *   • видит все доступные дизайны (глобальные от OkeyBook + свои);
 *   • создаёт свой дизайн на основе глобального («Создать на основе…»,
 *     меняя размеры под свою типографию);
 *   • удаляет свои дизайны.
 *
 * Дизайн для конкретного альбома выбирается ОТДЕЛЬНО в форме заказа —
 * любой дизайн сочетается с любым шаблоном (структурой). Структуры
 * (шаблоны вёрстки) живут на отдельной странице /app/templates.
 *
 * Раньше эта страница совмещала дизайны и шаблоны (каталог «дизайн →
 * шаблоны внутри»). После развязки разделено: дизайны здесь, шаблоны —
 * на /app/templates (плоский список структур, независимый от дизайна).
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CloneTemplateSetModal } from '@/app/app/templates/_components/CloneTemplateSetModal'
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

export default function DesignsListPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [designs, setDesigns] = useState<Design[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionTsId, setActionTsId] = useState<string | null>(null)
  const [cloneSource, setCloneSource] = useState<Design | null>(null)

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

  const handleCloneClick = useCallback((design: Design) => {
    setCloneSource(design)
  }, [])

  const handleCloneSuccess = useCallback(
    async (newTsId: string) => {
      setCloneSource(null)
      await loadDesigns()
      // eslint-disable-next-line no-console
      console.info('[clone] created new template_set:', newTsId)
    },
    [loadDesigns],
  )

  const handleDeleteClick = useCallback(
    async (design: Design) => {
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        `Удалить дизайн «${design.name}»?\n\n` +
          `Это действие необратимо. Если дизайн используется в альбомах ` +
          `или шаблонах — удалить не получится.`,
      )
      if (!ok) return

      setActionTsId(design.id)
      setError(null)
      try {
        const del = (force: boolean) =>
          api('/api/tenant', {
            method: 'POST',
            body: JSON.stringify({
              action: 'template_set_delete',
              template_set_id: design.id,
              force,
            }),
          })

        let r = await del(false)
        if (r.status === 409) {
          const d = await r.json().catch(() => ({}))
          if (d.can_force) {
            // eslint-disable-next-line no-alert
            const forceOk = window.confirm(
              `${d.error ?? 'Дизайн используется.'}\n\n` +
                `Удалить с отвязкой? Связанные альбомы и шаблоны переключатся ` +
                `на дизайн по умолчанию, их вёрстку придётся пересобрать. ` +
                `Действие необратимо.`,
            )
            if (!forceOk) return
            r = await del(true)
          } else {
            throw new Error(d.error ?? 'Дизайн используется')
          }
        }
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
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

  const globalDesigns = designs.filter((d) => d.is_global)
  const myDesigns = designs.filter((d) => !d.is_global)

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              <button
                onClick={() => router.push('/app')}
                className="hover:text-foreground"
              >
                Главная
              </button>
              {' / '}
              <span>Дизайны</span>
            </div>
            <h1 className="text-2xl font-bold">Дизайны</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Дизайн — визуальное оформление альбома (фоны, рамки, декор).
              Дизайн выбирается при создании заказа и сочетается с любым
              шаблоном (структурой). Здесь можно создать свой дизайн на основе
              готового или удалить свой. Структуры вёрстки —{' '}
              <button
                onClick={() => router.push('/app/templates')}
                className="text-brand-600 hover:text-brand-700 underline"
              >
                в разделе «Шаблоны»
              </button>
              .
            </p>
          </div>
          <button
            onClick={() => router.push('/app')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← К альбомам
          </button>
        </div>

        {loading && <div className="text-muted-foreground mb-4">Загрузка...</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {!loading && designs.length === 0 && (
          <div className="bg-card border border-border rounded p-6 text-center text-muted-foreground">
            Нет доступных дизайнов. Обратитесь в OkeyBook для подключения.
          </div>
        )}

        {/* Мои дизайны */}
        {myDesigns.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3">
              Мои дизайны
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({myDesigns.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {myDesigns.map((d) => (
                <DesignCard
                  key={d.id}
                  design={d}
                  onClone={null}
                  onDelete={() => handleDeleteClick(d)}
                  deleting={actionTsId === d.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Глобальные дизайны OkeyBook */}
        {globalDesigns.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              {myDesigns.length > 0 ? 'Дизайны от OkeyBook' : 'Доступные дизайны'}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({globalDesigns.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {globalDesigns.map((d) => (
                <DesignCard
                  key={d.id}
                  design={d}
                  onClone={() => handleCloneClick(d)}
                  onDelete={null}
                  deleting={false}
                />
              ))}
            </div>
          </section>
        )}
      </div>

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
  onClone,
  onDelete,
  deleting,
}: {
  design: Design
  /** Кнопка «Создать на основе...» — null для своих дизайнов. */
  onClone: (() => void) | null
  /** Кнопка «Удалить» — null для глобальных дизайнов. */
  onDelete: (() => void) | null
  deleting: boolean
}) {
  const hasPreviews = design.previews.length > 0

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 hover:border-brand-300 transition-all duration-150 flex flex-col">
      {/* Превью характерных мастеров дизайна */}
      <div className="mb-3">
        {hasPreviews ? (
          <div className="grid grid-cols-3 gap-2">
            {design.previews.map((svg, i) => (
              <div
                key={i}
                className="bg-muted border border-border rounded-lg overflow-hidden flex items-center justify-center"
                style={{ aspectRatio: '1 / 1.4', minHeight: '90px' }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ))}
            {Array.from({ length: 3 - design.previews.length }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="bg-muted border border-dashed border-border rounded-lg"
                style={{ aspectRatio: '1 / 1.4', minHeight: '90px' }}
              />
            ))}
          </div>
        ) : (
          <div
            className="bg-muted border border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground text-xs"
            style={{ aspectRatio: '3 / 1.4', minHeight: '90px' }}
          >
            Нет превью мастеров
          </div>
        )}
      </div>

      {/* Название */}
      <div className="font-semibold text-foreground truncate" title={design.name}>
        {design.name}
      </div>

      {/* Размеры */}
      {design.page_width_mm && design.page_height_mm && (
        <div className="text-xs text-muted-foreground mt-1">
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
          <span className="px-2.5 py-0.5 bg-muted text-muted-foreground text-xs font-medium rounded-full">
            твёрдая обложка
          </span>
        )}
        {design.print_type === 'soft' && (
          <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
            мягкая обложка
          </span>
        )}
      </div>

      {/* Кнопки действий */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        {onClone && (
          <button
            type="button"
            onClick={onClone}
            className="px-2.5 py-1 bg-muted hover:bg-muted text-foreground text-xs rounded-lg border border-border"
            title="Скопировать этот дизайн с изменёнными размерами под свою типографию"
          >
            Создать на основе…
          </button>
        )}
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
