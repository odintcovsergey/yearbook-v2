'use client'

// ─── SpreadBackgroundPicker ───────────────────────────────────────────────
//
// Этап 6 системы категорийных фонов. Модалка «Сменить фон» для ОДНОГО
// разворота в редакторе альбома. Партнёр выбирает конкретный фон вручную —
// он сохраняется как album override (ключ __bg__ в data ведущей страницы),
// перебивая автоматическую ротацию. Кнопка «Вернуть авто» сбрасывает override.
//
// Самодостаточная: получает пул фонов набора и текущее состояние пропсами,
// сами изменения отдаёт через onSelect/onReset (родитель пишет в layout + save).

import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  BACKGROUND_CATEGORY_LABELS,
  type BackgroundCategory,
} from '@/lib/backgrounds/page-role-to-category'
import type { BackgroundPoolRow } from '@/lib/backgrounds/resolve-background'

type Props = {
  /** Пул всех категорийных фонов набора. */
  backgrounds: BackgroundPoolRow[]
  /** Категория текущего разворота (по его ведущей странице). null = неизвестна. */
  category: string | null
  /** Текущий ручной override (путь фона) или null, если работает авторотация. */
  currentOverride: string | null
  /** Выбор фона: path — путь в bucket (то, что ляжет в __bg__). */
  onSelect: (path: string) => void
  /** Сброс override — вернуть авторотацию. */
  onReset: () => void
  onClose: () => void
}

function publicUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-backgrounds/${path}`
}

export default function SpreadBackgroundPicker({
  backgrounds,
  category,
  currentOverride,
  onSelect,
  onReset,
  onClose,
}: Props) {
  const [showAll, setShowAll] = useState(false)

  const categoryLabel = category
    ? BACKGROUND_CATEGORY_LABELS[category as BackgroundCategory] ?? category
    : null

  // Показываем либо фоны категории этого разворота, либо все (по тумблеру).
  const visible = useMemo(() => {
    if (showAll || !category) return backgrounds
    return backgrounds.filter((b) => b.category === category)
  }, [backgrounds, category, showAll])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Фон разворота</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {category
                ? <>Категория этого разворота: <b>{categoryLabel}</b>. По умолчанию фоны раздела чередуются автоматически — выберите конкретный, чтобы зафиксировать его на этом развороте.</>
                : 'Выберите фон для этого разворота.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {/* Управление */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={onReset}
            disabled={!currentOverride}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Убрать ручной фон, вернуть автоматическую ротацию раздела"
          >
            <RotateCcw size={14} /> Вернуть авто
          </button>
          {currentOverride ? (
            <span className="text-xs text-brand-600">Сейчас: фон задан вручную</span>
          ) : (
            <span className="text-xs text-gray-400">Сейчас: авто (ротация раздела)</span>
          )}
          {category && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              Показать фоны всех категорий
            </label>
          )}
        </div>

        {/* Сетка фонов */}
        <div className="px-5 py-4 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">
              {category && !showAll
                ? 'В этой категории пока нет загруженных фонов. Включите «все категории» или загрузите фоны в супер-админке.'
                : 'Фоны не загружены.'}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {visible.map((bg, i) => {
                const selected = bg.url === currentOverride
                return (
                  <button
                    key={`${bg.url}-${i}`}
                    type="button"
                    onClick={() => onSelect(bg.url)}
                    className={`relative rounded overflow-hidden border-2 transition-colors ${
                      selected
                        ? 'border-brand-500 ring-2 ring-brand-200'
                        : 'border-gray-200 hover:border-brand-300'
                    }`}
                    title={
                      showAll
                        ? BACKGROUND_CATEGORY_LABELS[bg.category as BackgroundCategory] ?? bg.category
                        : undefined
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={publicUrl(bg.url)}
                      alt="Фон"
                      className="w-full h-20 object-cover bg-gray-100"
                    />
                    {showAll && (
                      <span className="absolute bottom-0 left-0 right-0 text-[10px] bg-black/55 text-white px-1 py-0.5 truncate">
                        {BACKGROUND_CATEGORY_LABELS[bg.category as BackgroundCategory] ?? bg.category}
                      </span>
                    )}
                    {selected && (
                      <span className="absolute top-0.5 right-0.5 bg-brand-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                        ✓
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
