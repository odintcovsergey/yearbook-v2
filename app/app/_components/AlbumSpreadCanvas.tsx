'use client'

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Stage, Layer, Rect, Image as KonvaImage, Text, Group } from 'react-konva'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import type {
  SpreadInstance,
  SpreadTemplate,
  Placeholder,
  PhotoPlaceholder,
  TextPlaceholder,
} from '@/lib/album-builder/types'

// ─────────────────────────────────────────────────────────────────────────
// AlbumSpreadCanvas — Konva-рендер одного SpreadInstance.
//
// В отличие от app/super/templates/_components/SpreadCanvas.tsx (рисует
// только bbox'ы плейсхолдеров для просмотрщика шаблонов), этот компонент
// рисует РЕАЛЬНЫЙ контент: фото из instance.data[label] и текстовые
// значения. Используется в LayoutPreviewStrip (фаза 2.3) и в редакторе
// /app/album/[id]/layout (фаза 2.6).
//
// Координаты плейсхолдеров — в миллиметрах (как в БД, см. idml-recon §3).
// Stage применяет scale=containerWidth/template.width_mm; всё внутри
// Layer'а рисуется в мм-единицах.
//
// Шрифты: реальные fontFamily из placeholder.font_family (фаза 3.8).
// CSS @font-face для NotoSerif/OpenSans/Slimamif в app/globals.css —
// файлы из public/fonts/ те же что embed'ятся в PDF (lib/pdf-export/
// font-loader.ts). Fallback на serif если шрифт не загрузился.
// ─────────────────────────────────────────────────────────────────────────

const PT_TO_MM = 0.3528  // 1 typographic point = 0.3528 mm

type Mode = 'preview' | 'edit'

type Props = {
  instance: SpreadInstance
  template: SpreadTemplate
  containerWidth: number  // pixel-ширина Stage'а; Stage сам отскейлит до template.width_mm
  mode?: Mode  // default 'preview'
  // Drag handlers (используются в фазе 2.6, в 2.2 типизированы но не вызываются)
  onDrop?: (label: string, photoId: string) => void
  onSwap?: (fromLabel: string, toLabel: string) => void
  // 12.05.2026 (Л-pre-fix): если задан label фото которое сейчас drag'ается,
  // Konva-копия скрывается чтобы пользователь не видел двойную картинку
  // (Konva + DOM-overlay в DropZone). Передаётся из LayoutEditorPage.
  draggingLabel?: string | null
  // 12.05.2026 (Л.1): редактирование текста.
  // - editingTextLabel: label сейчас редактируемого text-placeholder'а
  //   (или null). Параллельно скрываем Konva TextSlot для него.
  // - onTextClick: callback при клике на text placeholder. Parent
  //   решает открывать ли editor (обычно — да, если canEdit).
  // - onTextSubmit/onTextCancel: вызываются из TextInlineEditor.
  editingTextLabel?: string | null
  onTextClick?: (label: string, currentValue: string | null) => void
  onTextSubmit?: (label: string, newValue: string | null) => void
  onTextCancel?: () => void
  // Л.2 — контекстное меню на photo placeholder (правый клик).
  // Parent получает label, текущий url, и координаты клика для позиционирования popover.
  onPhotoContextMenu?: (label: string, url: string | null, clientX: number, clientY: number) => void
  // Прототип балансировки — переопределение координат и видимости placeholder'ов.
  // Если placeholder есть в этой map с hidden=true — не рендерится вообще.
  // Если есть с x_mm/y_mm — рендерится по новым координатам.
  // Размеры (width_mm/height_mm) НЕ меняются.
  placeholderOverrides?: Record<string, { hidden?: boolean; x_mm?: number; y_mm?: number }>
}

// ─── Хелпер: загрузка HTMLImageElement из URL ────────────────────────────
//
// Возвращает null пока URL не пустой и картинка не загрузилась (или
// произошла ошибка загрузки). При смене URL очищает прежнее изображение.
function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) {
      setImg(null)
      return
    }
    // crossOrigin не используем: YC bucket не возвращает CORS headers,
    // и crossOrigin='anonymous' блокирует загрузку. Tainted canvas
    // допустимо в фазе 2 (PDF-экспорт через серверный pipeline в фазе 3).
    const i = new window.Image()
    i.src = url
    i.onload = () => setImg(i)
    i.onerror = () => setImg(null)
  }, [url])
  return img
}

// ─── Хелпер: cover crop (object-fit: cover в терминах Konva crop) ────────
function getCoverCrop(img: HTMLImageElement, targetW: number, targetH: number) {
  const targetRatio = targetW / targetH
  const imageRatio = img.naturalWidth / img.naturalHeight
  if (imageRatio > targetRatio) {
    const cropW = img.naturalHeight * targetRatio
    return {
      x: (img.naturalWidth - cropW) / 2,
      y: 0,
      width: cropW,
      height: img.naturalHeight,
    }
  }
  const cropH = img.naturalWidth / targetRatio
  return {
    x: 0,
    y: (img.naturalHeight - cropH) / 2,
    width: img.naturalWidth,
    height: cropH,
  }
}

// ─── Хелпер: проверка яркости цвета ──────────────────────────────────────
//
// Возвращает true если цвет слишком светлый (luminance > 0.7) или
// невалидный. Используется в TextSlot для fallback на чёрный когда
// placeholder.color из IDML светло-серый, который нечитаем на пустом
// светло-сером photo-слоте (см. инструкцию 2.6.1.1).
function isTooLight(hex: string | null | undefined): boolean {
  if (!hex) return true
  const m = hex.replace('#', '')
  if (m.length !== 3 && m.length !== 6) return true
  const expand = m.length === 3
    ? m.split('').map((c) => c + c).join('')
    : m
  const r = parseInt(expand.slice(0, 2), 16) / 255
  const g = parseInt(expand.slice(2, 4), 16) / 255
  const b = parseInt(expand.slice(4, 6), 16) / 255
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return true
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 0.7
}

// ─── Photo placeholder ────────────────────────────────────────────────────
function PhotoSlot({
  placeholder,
  url,
}: {
  placeholder: PhotoPlaceholder
  url: string | null
}) {
  const img = useImage(url)

  // Пустой слот → светло-серая заливка с видимой обводкой.
  // Партнёру важно видеть, где должно быть фото — на скейле миниатюры
  // тонкая dashed-рамка не различима, поэтому используем fill.
  if (!url || !img) {
    return (
      <Rect
        x={placeholder.x_mm}
        y={placeholder.y_mm}
        width={placeholder.width_mm}
        height={placeholder.height_mm}
        fill="#f3f4f6"
        stroke="#cbd5e1"
        strokeWidth={0.5}
      />
    )
  }

  const crop = getCoverCrop(img, placeholder.width_mm, placeholder.height_mm)

  // Круглые портреты (учительские) → клиппинг по эллипсу
  if (placeholder.is_circle) {
    const cx = placeholder.x_mm + placeholder.width_mm / 2
    const cy = placeholder.y_mm + placeholder.height_mm / 2
    const rx = placeholder.width_mm / 2
    const ry = placeholder.height_mm / 2
    return (
      <Group
        clipFunc={(ctx) => {
          ctx.beginPath()
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
          ctx.closePath()
        }}
      >
        <KonvaImage
          x={placeholder.x_mm}
          y={placeholder.y_mm}
          width={placeholder.width_mm}
          height={placeholder.height_mm}
          image={img}
          crop={crop}
        />
      </Group>
    )
  }

  return (
    <KonvaImage
      x={placeholder.x_mm}
      y={placeholder.y_mm}
      width={placeholder.width_mm}
      height={placeholder.height_mm}
      image={img}
      crop={crop}
    />
  )
}

// ─── Text placeholder ─────────────────────────────────────────────────────
function TextSlot({
  placeholder,
  value,
}: {
  placeholder: TextPlaceholder
  value: string | null
}) {
  if (!value) return null
  // Маппинг IDML font_weight (regular | bold | medium | light) на CSS weight.
  // Konva принимает fontStyle строку 'bold' или 'italic' (или 'normal').
  // Komнва не разбирает медиум/лайт — для этих весов получаем regular,
  // что для нашего use case (имена, цитаты) визуально приемлемо. Полная
  // поддержка сетки весов потребует custom font файлов NotoSerif-Medium
  // и т.д. — backlog.
  const fontStyle =
    placeholder.font_weight === 'bold' ? 'bold' : 'normal'
  return (
    <Text
      x={placeholder.x_mm}
      y={placeholder.y_mm}
      width={placeholder.width_mm}
      height={placeholder.height_mm}
      text={value}
      fontSize={placeholder.font_size_pt * PT_TO_MM}
      fontFamily={`${placeholder.font_family}, serif`}
      fontStyle={fontStyle}
      fill={isTooLight(placeholder.color) ? '#000000' : placeholder.color || '#000000'}
      align={placeholder.align}
      verticalAlign="top"
    />
  )
}

// ─── Text DropZone — DOM-overlay над text placeholder'ом ─────────────────
//
// Фаза Л.1 — клик-handler для редактирования текста. Прозрачный div
// поверх text-placeholder с cursor: text и hover ring. При клике
// зовёт onClick callback который parent (LayoutEditorPage) использует
// чтобы открыть TextInlineEditor.
//
// Рендерится для ВСЕХ text-placeholder'ов, включая пустые (где
// instance.data[label] === null) — иначе партнёр не сможет
// заполнить пустые слоты типа цитаты.
function TextDropZone({
  placeholder,
  scale,
  hasValue,
  onClick,
}: {
  placeholder: TextPlaceholder
  scale: number
  hasValue: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`absolute pointer-events-auto cursor-text transition-all ring-1 ring-transparent hover:ring-blue-300/60 hover:bg-blue-50/30 ${
        hasValue ? '' : 'bg-amber-50/40 ring-amber-200/60'
      }`}
      style={{
        left: `${placeholder.x_mm * scale}px`,
        top: `${placeholder.y_mm * scale}px`,
        width: `${placeholder.width_mm * scale}px`,
        height: `${placeholder.height_mm * scale}px`,
      }}
      title={hasValue ? 'Кликни для редактирования' : 'Кликни чтобы заполнить'}
    />
  )
}

// ─── Inline text editor — textarea точно поверх Konva-текста ─────────────
//
// Фаза Л.1 — редактирование текста (ФИО, год, заголовки) прямо
// на canvas'е. Textarea позиционируется и стилизуется так чтобы
// визуально совпадать с Konva-Text: тот же шрифт, размер, цвет,
// выравнивание.
//
// Конвертация font-size: Konva fontSize в Stage применяется в мм
// (после scale Stage'а). Реальный pixel-size = font_size_pt * PT_TO_MM
// * scale. Для textarea передаём это значение напрямую в style.fontSize.
//
// Поведение клавиш:
// - Enter без Shift → onSubmit (с пустой строкой → null = слот пустой)
// - Shift+Enter → перенос строки внутри textarea
// - Esc → onCancel (восстановить исходное значение)
// - Blur (клик вне) → onSubmit (без подтверждения, как auto-save)
//
// Параллельно Konva-TextSlot для этого label скрывается parent'ом
// (см. editingTextLabel в AlbumSpreadCanvas).
function TextInlineEditor({
  placeholder,
  scale,
  initialValue,
  onSubmit,
  onCancel,
}: {
  placeholder: TextPlaceholder
  scale: number
  initialValue: string | null
  onSubmit: (newValue: string | null) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)

  // Autofocus + выделение всего текста при монтировании. Партнёр
  // может сразу начать набирать — старый текст замещается.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const fontStyle =
    placeholder.font_weight === 'bold' ? 'bold' : 'normal'
  const color = isTooLight(placeholder.color)
    ? '#000000'
    : placeholder.color || '#000000'
  // Konva в Stage'е масштабирует на scale, поэтому реальный pixel
  // размер текста = font_size_pt * PT_TO_MM * scale. То же для
  // textarea — рендерится в DOM поверх Stage'а уже отскейленным.
  const fontSizePx = placeholder.font_size_pt * PT_TO_MM * scale

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      // Пустая строка → null (слот пустой). Иначе value.
      const trimmed = value.trim()
      onSubmit(trimmed === '' ? null : value)
      return
    }
  }

  function handleBlur() {
    // Blur — это «мягкий submit». Сохраняем то что напечатано,
    // без potentially неожиданного reset'а.
    const trimmed = value.trim()
    onSubmit(trimmed === '' ? null : value)
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      // stopPropagation на pointer/mouse events чтобы клики внутри
      // textarea не вызывали повторное открытие TextDropZone.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute pointer-events-auto"
      style={{
        left: `${placeholder.x_mm * scale}px`,
        top: `${placeholder.y_mm * scale}px`,
        width: `${placeholder.width_mm * scale}px`,
        height: `${placeholder.height_mm * scale}px`,
        fontFamily: `${placeholder.font_family}, serif`,
        fontSize: `${fontSizePx}px`,
        fontWeight: fontStyle === 'bold' ? 700 : 400,
        color,
        textAlign: placeholder.align,
        // Visual: тонкая синяя рамка чтобы было видно где редактируется,
        // полупрозрачный белый фон чтобы текст читался поверх фона
        // мастера (если есть background_url).
        padding: 0,
        margin: 0,
        border: '2px solid #3b82f6',
        outline: 'none',
        background: 'rgba(255, 255, 255, 0.92)',
        resize: 'none',
        overflow: 'hidden',
        // line-height: Konva по дефолту использует lineHeight=1 (без
        // дополнительного межстрочного промежутка). Для textarea
        // ставим то же.
        lineHeight: 1,
        // verticalAlign: Konva рисует с top alignment (verticalAlign='top'),
        // textarea по умолчанию тоже top-aligned. ОК.
        boxSizing: 'border-box',
        zIndex: 30,
      }}
    />
  )
}


// ─── Drop-target над Konva-placeholder'ом + draggable если есть фото ─────
//
// 2.6.3 — только droppable. 2.6.4 — добавлен draggable для swap'а
// между placeholder'ами. Если photo-слот пуст (нет url), drag
// disabled.
//
// 12.05.2026 (Л-pre-fix) — рендерим img-copy ВНУТРИ DropZone с CSS
// transform когда isDragging. Раньше использовался DragOverlay через
// React portal — в нашем layout @dnd-kit неправильно позиционировал
// overlay (курсор оказывался у левого-верхнего угла независимо от
// точки клика). CSS transform на DOM-элементе гарантированно сохраняет
// точку клика под курсором (это базовое поведение translate). Konva
// фото на время drag скрывается через draggingLabel prop в parent'е.
function DropZone({
  placeholder,
  scale,
  url,
  onContextMenu,
}: {
  placeholder: PhotoPlaceholder
  scale: number
  url: string | null
  // Л.2 — правый клик на photo слот открывает popover с действиями
  // (Очистить / Заменить оригинал). Координаты клика передаются parent'у
  // чтобы он мог позиционировать popover.
  onContextMenu?: (label: string, url: string | null, clientX: number, clientY: number) => void
}) {
  const hasValue = !!url
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: placeholder.label,
  })
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
    transform,
  } = useDraggable({
    id: `placeholder-${placeholder.label}`,
    data: { type: 'placeholder', label: placeholder.label, url },
    disabled: !hasValue,
  })

  // Объединяем оба ref'а: один div одновременно droppable И draggable
  const setRef = (node: HTMLElement | null) => {
    setDropRef(node)
    setDragRef(node)
  }

  return (
    <div
      ref={setRef}
      {...(hasValue ? { ...attributes, ...listeners } : {})}
      onContextMenu={(e) => {
        // Только если есть фото — иначе нечего «делать» в меню.
        // Также блокируем native browser menu (там бесполезные пункты
        // типа Save Image As для пустого div'a).
        if (!onContextMenu) return
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(placeholder.label, url, e.clientX, e.clientY)
      }}
      className={`absolute pointer-events-auto transition-all ${
        isOver
          ? 'ring-2 ring-blue-500 bg-blue-100/40'
          : 'ring-1 ring-transparent hover:ring-blue-300/50'
      } ${
        hasValue ? 'cursor-move' : 'cursor-default'
      }`}
      style={{
        left: `${placeholder.x_mm * scale}px`,
        top: `${placeholder.y_mm * scale}px`,
        width: `${placeholder.width_mm * scale}px`,
        height: `${placeholder.height_mm * scale}px`,
      }}
    >
      {/* Drag-preview: видна только когда фото перетаскивается.
          CSS translate(transform.x, transform.y) гарантирует что точка
          клика остаётся под курсором. zIndex: 10 поднимает над другими
          DropZone'ами. pointerEvents: none чтобы курсор продолжал
          hit-test'ить drop-зоны под preview. */}
      {isDragging && hasValue && transform && (
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px)`,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <img
            src={url ?? undefined}
            alt=""
            draggable={false}
            className="w-full h-full object-cover rounded border-2 border-blue-500 shadow-xl"
            style={{ opacity: 0.9, display: 'block' }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────
export default function AlbumSpreadCanvas({
  instance,
  template,
  containerWidth,
  mode = 'preview',
  draggingLabel,
  editingTextLabel,
  onTextClick,
  onTextSubmit,
  onTextCancel,
  onPhotoContextMenu,
  placeholderOverrides,
}: Props) {
  const scale = containerWidth / template.width_mm
  const stageWidth = template.width_mm * scale
  const stageHeight = template.height_mm * scale

  // Применяем placeholderOverrides — фильтруем hidden, переписываем координаты
  // у видимых. Делаем неглубокий клон template чтобы не мутировать оригинал.
  const effectiveTemplate = placeholderOverrides
    ? {
        ...template,
        placeholders: template.placeholders
          .filter((p) => !placeholderOverrides[p.label]?.hidden)
          .map((p) => {
            const ov = placeholderOverrides[p.label]
            if (!ov) return p
            return {
              ...p,
              x_mm: ov.x_mm ?? p.x_mm,
              y_mm: ov.y_mm ?? p.y_mm,
            }
          }),
      }
    : template

  return (
    <div
      className="relative"
      style={{ width: `${stageWidth}px`, height: `${stageHeight}px` }}
    >
      <Stage
        width={stageWidth}
        height={stageHeight}
        scaleX={scale}
        scaleY={scale}
        listening={mode === 'edit'}
      >
        <Layer>
          {/* Фон spread'а — серый прямоугольник с тонкой границей */}
          <Rect
            x={0}
            y={0}
            width={template.width_mm}
            height={template.height_mm}
            fill="#fafafa"
            stroke="#e5e7eb"
            strokeWidth={0.3}
          />

          {/* Контент из instance.data */}
          {effectiveTemplate.placeholders.map((p: Placeholder, i) => {
            const value = instance.data[p.label] ?? null
            const key = `${p.label}-${i}`
            if (p.type === 'photo') {
              // Скрываем Konva-копию фото на время drag — preview
              // отрисовывается через DOM-overlay в DropZone (CSS transform)
              if (draggingLabel === p.label) return null
              return <PhotoSlot key={key} placeholder={p} url={value} />
            }
            if (p.type === 'text') {
              // Скрываем Konva TextSlot когда этот label сейчас редактируется
              // — параллельно поверх отрисовывается TextInlineEditor.
              if (editingTextLabel === p.label) return null
              return <TextSlot key={key} placeholder={p} value={value} />
            }
            return null
          })}
        </Layer>
      </Stage>

      {/* DOM-overlay с drop-target'ами и text-edit overlay'ами (только в edit-режиме) */}
      {mode === 'edit' && (
        <div className="absolute inset-0 pointer-events-none">
          {effectiveTemplate.placeholders.map((p) => {
            if (p.type === 'photo') {
              return (
                <DropZone
                  key={`photo-${p.label}`}
                  placeholder={p}
                  scale={scale}
                  url={instance.data[p.label] ?? null}
                  onContextMenu={onPhotoContextMenu}
                />
              )
            }
            if (p.type === 'text') {
              const value = instance.data[p.label] ?? null
              // Когда этот text-placeholder редактируется — рендерим
              // textarea-editor. Иначе — прозрачный кликабельный DropZone
              // с cursor:text и hover ring.
              if (editingTextLabel === p.label) {
                return (
                  <TextInlineEditor
                    key={`text-edit-${p.label}`}
                    placeholder={p}
                    scale={scale}
                    initialValue={value}
                    onSubmit={(newValue) => onTextSubmit?.(p.label, newValue)}
                    onCancel={() => onTextCancel?.()}
                  />
                )
              }
              return (
                <TextDropZone
                  key={`text-${p.label}`}
                  placeholder={p}
                  scale={scale}
                  hasValue={!!value}
                  onClick={() => onTextClick?.(p.label, value)}
                />
              )
            }
            return null
          })}
        </div>
      )}
    </div>
  )
}
