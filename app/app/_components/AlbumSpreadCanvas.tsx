'use client'

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type FocusEvent as ReactFocusEvent } from 'react'
import { Stage, Layer, Rect, Image as KonvaImage, Text, Group } from 'react-konva'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import type {
  SpreadInstance,
  SpreadTemplate,
  Placeholder,
  PhotoPlaceholder,
  TextPlaceholder,
} from '@/lib/album-builder/types'
import {
  computeCrop,
  parseScale,
  parseOffset,
  parseRotate,
  computeAutoZoomForRotation,
  hasCustomTransform,
} from '@/lib/photo-transform'
import {
  parseBalanceOverrides,
  applyBalanceOverrides,
} from '@/lib/balance-overrides'
import { parseFontSizeMult, parseColor } from '@/lib/text-style'

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
  onTextClick?: (label: string, currentValue: string | null, clientX: number, clientY: number) => void
  onTextSubmit?: (label: string, newValue: string | null) => void
  onTextCancel?: () => void
  // Л.2 — контекстное меню на photo placeholder (правый клик).
  // Parent получает label, текущий url, и координаты клика для позиционирования popover.
  onPhotoContextMenu?: (label: string, url: string | null, clientX: number, clientY: number) => void
  // КЭ.5 — одинарный левый клик на photo placeholder. Открывает
  // PhotoTransformPanel для кадрирования (scale + offset). dnd-kit
  // отменяет click при движении мыши, так что drag не триггерит этот
  // handler. Срабатывает только при url != null (нет смысла кадрировать
  // пустой слот).
  onPhotoClick?: (label: string, url: string, clientX: number, clientY: number) => void
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
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  rotateDeg = 0,
}: {
  placeholder: PhotoPlaceholder
  url: string | null
  // КЭ.2 — transform параметры из __scale__<label> / __offset__<label>.
  // Default = 1.0 / 0,0 → текущее cover-crop поведение (полная обратная
  // совместимость). См. lib/photo-transform/index.ts и
  // docs/phase-content-edit-spec.md.
  scale?: number
  offsetX?: number
  offsetY?: number
  // Р.2 — поворот фото (горизонт). Применяется на ВЕРХ scale/offset:
  // изображение поворачивается вокруг центра рамки на заданный угол.
  // Чтобы рамка не была пустой по углам, applied auto-zoom factor
  // (computeAutoZoomForRotation) увеличивает render-размер изображения
  // и обрезает по clipFunc до прямоугольника рамки.
  rotateDeg?: number
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

  // КЭ.2: используем computeCrop с scale/offset вместо getCoverCrop.
  // При scale=1, offset=(0,0) результат идентичен getCoverCrop (regression
  // safe). computeCrop возвращает CropParams в натуральных пикселях
  // исходного изображения — что и ожидает Konva crop prop.
  const targetRatio = placeholder.width_mm / placeholder.height_mm
  const cropParams = computeCrop(
    img.naturalWidth,
    img.naturalHeight,
    targetRatio,
    scale,
    offsetX,
    offsetY,
  )
  // Konva crop format: { x, y, width, height } в координатах источника
  const crop = {
    x: cropParams.cropX,
    y: cropParams.cropY,
    width: cropParams.cropW,
    height: cropParams.cropH,
  }

  // Р.2 — auto-zoom factor для покрытия рамки повёрнутым изображением.
  // При rotateDeg=0 factor=1 → KonvaImage рендерится точно в размере
  // рамки (regression-safe). При rotateDeg≠0 factor>1 → KonvaImage
  // занимает больший прямоугольник, центрирован по центру рамки,
  // повёрнут — а clipFunc обрезает по контуру рамки.
  const autoZoom = computeAutoZoomForRotation(rotateDeg, targetRatio)
  const renderW = placeholder.width_mm * autoZoom
  const renderH = placeholder.height_mm * autoZoom
  const centerX = placeholder.x_mm + placeholder.width_mm / 2
  const centerY = placeholder.y_mm + placeholder.height_mm / 2

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
          x={centerX}
          y={centerY}
          width={renderW}
          height={renderH}
          offsetX={renderW / 2}
          offsetY={renderH / 2}
          rotation={rotateDeg}
          image={img}
          crop={crop}
        />
      </Group>
    )
  }

  // Прямоугольная рамка. Без поворота — fast path: позиционирование
  // как было до Р.2 (KonvaImage напрямую без Group). С поворотом —
  // клиппинг по прямоугольнику + центрированная повёрнутая картинка.
  if (rotateDeg === 0) {
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

  return (
    <Group
      clipFunc={(ctx) => {
        ctx.beginPath()
        ctx.rect(
          placeholder.x_mm,
          placeholder.y_mm,
          placeholder.width_mm,
          placeholder.height_mm,
        )
        ctx.closePath()
      }}
    >
      <KonvaImage
        x={centerX}
        y={centerY}
        width={renderW}
        height={renderH}
        offsetX={renderW / 2}
        offsetY={renderH / 2}
        rotation={rotateDeg}
        image={img}
        crop={crop}
      />
    </Group>
  )
}

// ─── Text placeholder ─────────────────────────────────────────────────────
function TextSlot({
  placeholder,
  value,
  fontSizeMult = 1,
  colorOverride = null,
}: {
  placeholder: TextPlaceholder
  value: string | null
  // Р.3 — override стиля. Default (1.0, null) → используется placeholder.color
  // и placeholder.font_size_pt (regression-safe).
  fontSizeMult?: number
  colorOverride?: string | null
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
  // Р.3: размер = base * mult, цвет — override → placeholder.color →
  // fallback '#000000' если IDML отдал слишком светлый.
  const baseColor = isTooLight(placeholder.color)
    ? '#000000'
    : placeholder.color || '#000000'
  const finalColor = colorOverride ?? baseColor
  return (
    <Text
      x={placeholder.x_mm}
      y={placeholder.y_mm}
      width={placeholder.width_mm}
      height={placeholder.height_mm}
      text={value}
      fontSize={placeholder.font_size_pt * PT_TO_MM * fontSizeMult}
      fontFamily={`${placeholder.font_family}, serif`}
      fontStyle={fontStyle}
      fill={finalColor}
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
  onClick: (clientX: number, clientY: number) => void
}) {
  return (
    <div
      onClick={(e) => onClick(e.clientX, e.clientY)}
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
  fontSizeMult = 1,
  colorOverride = null,
  onSubmit,
  onCancel,
}: {
  placeholder: TextPlaceholder
  scale: number
  initialValue: string | null
  /** Р.3 — override размера (мультипликатор) и цвета. Default (1, null). */
  fontSizeMult?: number
  colorOverride?: string | null
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
  const baseColor = isTooLight(placeholder.color)
    ? '#000000'
    : placeholder.color || '#000000'
  // Р.3: override цвета → fallback на placeholder.color.
  const color = colorOverride ?? baseColor
  // Konva в Stage'е масштабирует на scale, поэтому реальный pixel
  // размер текста = font_size_pt * PT_TO_MM * scale. То же для
  // textarea — рендерится в DOM поверх Stage'а уже отскейленным.
  // Р.3: применяется fontSizeMult.
  const fontSizePx = placeholder.font_size_pt * PT_TO_MM * scale * fontSizeMult

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

  function handleBlur(e: ReactFocusEvent<HTMLTextAreaElement>) {
    // РЭ.52.b: если фокус ушёл В нашу TextStylePanel — НЕ submit'им.
    // Это позволяет:
    //   - клик по слайдеру размера в TextStylePanel → range получает
    //     фокус → textarea blur'ится → ЭТОТ guard перехватывает →
    //     textarea НЕ закрывается → panel остаётся открытой и
    //     слайдер плавно тянется
    //   - клик по color swatch → button получает фокус → blur →
    //     guard → не закрываемся.
    // Определяем по data-атрибуту: TextStylePanel ставит data-text-
    // style-panel="true" на wrapper'е. e.relatedTarget — это куда
    // переходит фокус.
    const next = e.relatedTarget as HTMLElement | null
    if (next && next.closest('[data-text-style-panel="true"]')) {
      return // фокус в нашу панель — игнорируем blur, не submit'им
    }
    // Иначе — обычный «мягкий submit». Сохраняем то что напечатано,
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
  instanceKey,
  onContextMenu,
  onClick,
  hasCustomTransform: hasCustomTransformProp = false,
}: {
  placeholder: PhotoPlaceholder
  scale: number
  url: string | null
  // РЭ.35.Е.3 — уникальный ключ инстанса (= spread_index страницы).
  // Когда на развороте слева+справа стоят canvas с ОДИНАКОВЫМ шаблоном
  // (например M-Grid-Page+M-Grid-Page), у placeholder'ов одинаковые
  // label. Без instanceKey dnd-kit считает их одним droppable/draggable
  // → drag на правой странице регистрируется и на левой (баг 3 от
  // Сергея 23.05).
  instanceKey: string | number
  // Л.2 — правый клик на photo слот открывает popover с действиями
  // (Очистить / Заменить оригинал). Координаты клика передаются parent'у
  // чтобы он мог позиционировать popover.
  onContextMenu?: (label: string, url: string | null, clientX: number, clientY: number) => void
  // КЭ.5 — одинарный левый клик. Срабатывает только при url != null.
  // dnd-kit отменяет click при движении мыши с зажатой кнопкой, так что
  // drag не триггерит этот handler.
  onClick?: (label: string, url: string, clientX: number, clientY: number) => void
  // КЭ.6 — true если у фото в этом слоте есть кастомный crop
  // (data[__scale__<label>] или data[__offset__<label>] не default).
  // Отображается маленький бейдж '⚙' в углу.
  hasCustomTransform?: boolean
}) {
  const hasValue = !!url
  // ID droppable/draggable: label@instanceKey. Парсер в parent
  // handleDragEnd разбирает обратно.
  const dropId = `${placeholder.label}@${instanceKey}`
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId,
  })
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
    transform,
  } = useDraggable({
    id: `placeholder-${placeholder.label}@${instanceKey}`,
    data: {
      type: 'placeholder',
      label: placeholder.label,
      instanceKey,
      url,
    },
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
      onClick={(e) => {
        // КЭ.5: одинарный клик → кадрирование. Только если есть фото
        // (нечего кадрировать в пустом слоте). dnd-kit отменяет click
        // если был drag, так что отдельный гард не нужен.
        if (!onClick || !url) return
        e.stopPropagation()
        onClick(placeholder.label, url, e.clientX, e.clientY)
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

      {/* КЭ.6 — индикатор «Кадрирован вручную».
          Маленький значок ⚙ в правом верхнем углу photo placeholder'а.
          Видим только если data содержит non-default __scale__ или __offset__
          для этого label. Помогает партнёру отличить автоматический crop
          (default cover) от рукотворного — особенно после переключений
          разворотов где не сразу видно где он подкручивал. */}
      {hasCustomTransformProp && hasValue && !isDragging && (
        <div
          className="absolute top-1 right-1 bg-blue-600 text-white text-[10px] leading-none rounded-full w-4 h-4 flex items-center justify-center shadow pointer-events-none"
          title="Это фото кадрировано вручную (изменён масштаб или позиция)"
          aria-label="Кадрировано вручную"
        >
          ⚙
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
  onPhotoClick,
  placeholderOverrides,
}: Props) {
  const scale = containerWidth / template.width_mm
  const stageWidth = template.width_mm * scale
  const stageHeight = template.height_mm * scale

  // БТ.1 — балансировка из rule engine через data служебные ключи.
  // Если parent передал placeholderOverrides (прототипы /super) —
  // используем как есть. Иначе строим из instance.data через
  // shared модуль lib/balance-overrides.
  const effectiveOverrides =
    placeholderOverrides ?? parseBalanceOverrides(instance.data) ?? undefined

  // Применяем overrides — фильтруем hidden, переписываем координаты.
  // Не мутируем оригинал.
  const effectiveTemplate = effectiveOverrides
    ? {
        ...template,
        placeholders: applyBalanceOverrides(template.placeholders, effectiveOverrides),
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
              // КЭ.2: служебные ключи __scale__<label> / __offset__<label>
              // из instance.data. Default (отсутствие ключей) →
              // scale=1, offset=(0,0) → текущее cover-crop поведение.
              // См. docs/phase-content-edit-spec.md и lib/photo-transform.
              // Р.2: __rotate__<label> — поворот фото внутри рамки.
              const sc = parseScale(instance.data[`__scale__${p.label}`])
              const [ox, oy] = parseOffset(instance.data[`__offset__${p.label}`])
              const rot = parseRotate(instance.data[`__rotate__${p.label}`])
              return (
                <PhotoSlot
                  key={key}
                  placeholder={p}
                  url={value}
                  scale={sc}
                  offsetX={ox}
                  offsetY={oy}
                  rotateDeg={rot}
                />
              )
            }
            if (p.type === 'text') {
              // Скрываем Konva TextSlot когда этот label сейчас редактируется
              // — параллельно поверх отрисовывается TextInlineEditor.
              if (editingTextLabel === p.label) return null
              // Р.3 — override стиля из служебных ключей. Default
              // (отсутствие ключей) → mult=1, color=null → используется
              // placeholder.font_size_pt / placeholder.color.
              const fsMult = parseFontSizeMult(instance.data[`__fontSize__${p.label}`])
              const colorOv = parseColor(instance.data[`__color__${p.label}`])
              return (
                <TextSlot
                  key={key}
                  placeholder={p}
                  value={value}
                  fontSizeMult={fsMult}
                  colorOverride={colorOv}
                />
              )
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
              // КЭ.6 — детект non-default transform для бейджа.
              // parseScale/parseOffset возвращают (1, 0, 0) если ключи
              // отсутствуют → hasCustomTransform == false.
              // Р.2 — учитываем также __rotate__.
              const sc = parseScale(instance.data[`__scale__${p.label}`])
              const [ox, oy] = parseOffset(instance.data[`__offset__${p.label}`])
              const rot = parseRotate(instance.data[`__rotate__${p.label}`])
              const hasCustom = hasCustomTransform(sc, ox, oy, rot)
              return (
                <DropZone
                  key={`photo-${p.label}`}
                  placeholder={p}
                  scale={scale}
                  url={instance.data[p.label] ?? null}
                  instanceKey={instance.spread_index}
                  onContextMenu={onPhotoContextMenu}
                  onClick={onPhotoClick}
                  hasCustomTransform={hasCustom}
                />
              )
            }
            if (p.type === 'text') {
              const value = instance.data[p.label] ?? null
              // Когда этот text-placeholder редактируется — рендерим
              // textarea-editor. Иначе — прозрачный кликабельный DropZone
              // с cursor:text и hover ring.
              if (editingTextLabel === p.label) {
                // Р.3 — те же overrides из data что и TextSlot.
                const fsMult = parseFontSizeMult(instance.data[`__fontSize__${p.label}`])
                const colorOv = parseColor(instance.data[`__color__${p.label}`])
                return (
                  <TextInlineEditor
                    key={`text-edit-${p.label}`}
                    placeholder={p}
                    scale={scale}
                    initialValue={value}
                    fontSizeMult={fsMult}
                    colorOverride={colorOv}
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
                  onClick={(cx, cy) => onTextClick?.(p.label, value, cx, cy)}
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
