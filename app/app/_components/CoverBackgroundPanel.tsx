'use client'

/**
 * Панель «Фон» редактора обложек. Показывает доступные фоны дизайна (фоны
 * обложек того же template_set) + «Фон дизайна» (вернуть фон мастера) + «Без
 * фона», и даёт загрузить новый файл (presigned, обход HTTP 413).
 *
 * Применение по контексту открытой обложки: для портретной (ученик) — поштучно,
 * иначе шаблонно на тип. Чекбокс «применить ко всем такого типа» переключает
 * поштучную правку на шаблонную (на все обложки этого типа).
 *
 * Значение сохраняется в cover_edits.__bg__ (см. lib/cover/editor-merge):
 *   url   — этот фон; 'none' — явно без фона; null — вернуть фон дизайна.
 */

import { useState } from 'react'
import { X, Upload, Loader2, Check } from 'lucide-react'
import { COVER_BG_NONE, signCoverBg } from '@/lib/cover/editor-merge'
import { uploadAlbumCoverBackground } from '../album/[id]/cover/coverBgUpload'

type Bg = { url: string; name: string }

type Props = {
  albumId: string
  /** Сырая правка __bg__ открытой обложки: url | 'none' | null/undefined (нет правки). */
  currentOverride: string | null | undefined
  /** Фон мастера (для плитки «Фон дизайна»). */
  masterBg: string | null
  backgrounds: Bg[]
  /**
   * Переезд на Timeweb: карта «ключ фона → signed URL» (только режим timeweb).
   * Превью показываем подписанным; выбор/сохранение остаются на ключах bg.url.
   */
  bgSigned?: Record<string, string> | null
  /** Открыта обложка ученика (портретная) — доступен выбор «ко всем такого типа». */
  isPerStudent: boolean
  typeLabel: string
  /** bgValue: url | 'none' (без фона) | null (вернуть фон дизайна). */
  onApply: (bgValue: string | null, applyToAll: boolean) => void
  /** Новый загруженный фон — добавить в список доступных (+ signed для показа). */
  onUploaded: (bg: { url: string; name: string; readUrl?: string }) => void
  onClose: () => void
}

export default function CoverBackgroundPanel({
  albumId, currentOverride, masterBg, backgrounds, bgSigned, isPerStudent, typeLabel,
  onApply, onUploaded, onClose,
}: Props) {
  const [applyToAll, setApplyToAll] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Текущее выбранное значение: undefined/null = фон дизайна (нет правки).
  const isNone = currentOverride === COVER_BG_NONE || currentOverride === ''
  const isDesign = currentOverride === undefined || currentOverride === null
  const selectedUrl = !isNone && !isDesign ? currentOverride : null

  const handleUpload = async (file: File | null) => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const { url, readUrl } = await uploadAlbumCoverBackground(albumId, file)
      onUploaded({ url, name: 'Загруженный фон', readUrl })
      onApply(url, applyToAll)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить фон')
    } finally {
      setUploading(false)
    }
  }

  const Tile = ({
    selected, onClick, children, title,
  }: { selected: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`relative rounded-lg overflow-hidden border-2 aspect-[3/2] bg-muted flex items-center justify-center text-xs text-muted-foreground transition-colors ${
        selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border hover:border-brand-300'
      }`}
    >
      {children}
      {selected && (
        <span className="absolute top-1 right-1 bg-brand-500 text-white rounded-full p-0.5">
          <Check size={12} />
        </span>
      )}
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Фон обложки</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Закрыть"><X size={18} /></button>
        </div>

        {isPerStudent && (
          <label className="flex items-center gap-2 mb-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => {
                const checked = e.target.checked
                setApplyToAll(checked)
                // Поток «выбрал фон → нажал галочку»: при включении сразу
                // применяем уже выбранный на этой обложке фон ко всему типу
                // (включая текущую — см. setStudentKeys, снимающий override).
                if (checked) {
                  const current = isNone ? COVER_BG_NONE : isDesign ? null : (currentOverride ?? null)
                  onApply(current, true)
                }
              }}
            />
            Применить ко всем обложкам типа «{typeLabel}»
          </label>
        )}
        {isPerStudent && !applyToAll && (
          <div className="text-xs text-muted-foreground mb-3">Фон изменится только у этой обложки ученика.</div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {/* Фон дизайна (вернуть фон мастера). */}
          <Tile selected={isDesign} onClick={() => onApply(null, applyToAll)} title="Вернуть фон дизайна">
            {masterBg
              ? <img src={signCoverBg(masterBg, bgSigned) ?? masterBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
              : <span>Фон дизайна</span>}
            <span className="absolute bottom-0 inset-x-0 bg-black/40 text-white text-[10px] py-0.5 text-center">Фон дизайна</span>
          </Tile>

          {/* Без фона. */}
          <Tile selected={isNone} onClick={() => onApply(COVER_BG_NONE, applyToAll)} title="Без фона">
            <span>Без фона</span>
          </Tile>

          {/* Доступные фоны дизайна. */}
          {backgrounds.map((bg) => (
            <Tile key={bg.url} selected={selectedUrl === bg.url} onClick={() => onApply(bg.url, applyToAll)} title={bg.name}>
              <img src={signCoverBg(bg.url, bgSigned) ?? bg.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
            </Tile>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <label className={`btn-secondary inline-flex items-center gap-2 cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {uploading ? 'Загружаю…' : 'Загрузить новый фон'}
            <input
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              disabled={uploading}
              onChange={(e) => { handleUpload(e.target.files?.[0] ?? null); e.target.value = '' }}
            />
          </label>
          <div className="text-xs text-muted-foreground mt-1">JPG или PNG. Большие файлы грузятся напрямую в хранилище.</div>
          {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
        </div>
      </div>
    </div>
  )
}
