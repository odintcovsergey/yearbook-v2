'use client'

import { useEffect, useRef } from 'react'

// PhotoContextMenu — popover-меню с действиями для фото в редакторе.
//
// Появляется при правом клике на photo placeholder в AlbumSpreadCanvas.
// Позиционируется по координатам клика (clientX/clientY). Автоматически
// закрывается при клике вне меню или по Esc.
//
// Действия в MVP (Л.2):
//   - Очистить слот — data[label] = null
//   - Заменить оригинал — file picker → PUT в YC → rebind_retouched (К.3)
//     WebP и data[label] не меняются, PDF-экспорт берёт новый оригинал
//
// Зарезервированы на Л.2.5 / Л.3 (если решим расширять):
//   - Загрузить новое фото (загрузка + register_photo + автозамена в слот)
//   - Заменить из палитры (auto-focus на палитре с фильтром)

type PhotoContextMenuProps = {
  label: string
  url: string | null
  clientX: number
  clientY: number
  // Информация о photo по url'у — нужна для action'ов (нужен photo_id
  // и текущий original_path для rebind). Может быть null если url
  // не найден в списке фото альбома (странный кейс).
  photoInfo: { id: string; album_id: string; has_original: boolean } | null
  onClear: () => void
  // Загрузить новое фото целиком (WebP + оригинал) и поставить в этот слот.
  // Обновляет превью в макете И оригинал для PDF — обычный happy path.
  onReplaceFull: () => void
  // Подменить только оригинал — превью в макете НЕ меняется, обновляется
  // только source для PDF. Используется для доретуши после согласования.
  onReplaceOriginal: () => void
  onClose: () => void
}

export default function PhotoContextMenu({
  label,
  url,
  clientX,
  clientY,
  photoInfo,
  onClear,
  onReplaceFull,
  onReplaceOriginal,
  onClose,
}: PhotoContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Закрытие по клику вне меню и по Esc.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // mousedown — раньше чем click, чтобы поймать клик ДО других элементов
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Корректируем позицию если popover вылазит за край viewport'а.
  // Оценочная ширина меню 220px, высота ~110px (2 пункта + заголовок).
  const MENU_WIDTH = 240
  const MENU_HEIGHT = 130
  let left = clientX
  let top = clientY
  if (typeof window !== 'undefined') {
    if (left + MENU_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - MENU_WIDTH - 8)
    }
    if (top + MENU_HEIGHT > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - MENU_HEIGHT - 8)
    }
  }

  return (
    <div
      ref={ref}
      className="fixed bg-card rounded-lg shadow-xl border border-border py-1.5 z-50 select-none"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${MENU_WIDTH}px`,
      }}
    >
      <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border mb-1 truncate" title={label}>
        Фото: {label}
      </div>

      <button
        type="button"
        onClick={() => {
          onClear()
          onClose()
        }}
        disabled={!url}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        title={url ? 'Убрать фото из слота' : 'Слот уже пустой'}
      >
        <span>🗑</span>
        <span>Очистить слот</span>
      </button>

      {/* Главный happy path — заменить фото полностью. Меняется ВСЁ:
          превью на canvas и оригинал для PDF. Это то что обычно ожидает
          партнёр когда говорит «хочу другое фото». */}
      <button
        type="button"
        onClick={() => {
          onReplaceFull()
          onClose()
        }}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
        title="Выбрать новое фото с компьютера. Превью в макете обновится, оригинал тоже загрузится для печати."
      >
        <span>📷</span>
        <span>Загрузить другое фото</span>
      </button>

      <div className="px-3 py-1 mt-1 text-[10px] text-muted-foreground uppercase tracking-wide border-t border-border">
        Продвинутое
      </div>

      {/* Продвинутый use-case — заменить ТОЛЬКО оригинал. WebP в макете
          не меняется. Используется когда макет согласован с клиентом,
          и нужно дорeтушировать конкретное фото без пересогласования. */}
      <button
        type="button"
        onClick={() => {
          onReplaceOriginal()
          onClose()
        }}
        disabled={!photoInfo}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        title={
          !photoInfo
            ? 'Информация о фото недоступна'
            : photoInfo.has_original
              ? 'Подменить ТОЛЬКО оригинал для печати. Превью в макете останется прежним. Используйте если клиент согласовал макет, но просит доретушировать одно фото.'
              : 'У этого фото пока нет оригинала. Загрузить файл — он станет оригиналом для PDF-экспорта (превью в макете не изменится).'
        }
      >
        <span>🎨</span>
        <span>{photoInfo?.has_original ? 'Подменить только оригинал' : 'Загрузить только оригинал'}</span>
      </button>
    </div>
  )
}
