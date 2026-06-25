'use client'

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent, type KeyboardEvent as ReactKeyboardEvent, type FocusEvent as ReactFocusEvent } from 'react'
import { Stage, Layer, Rect, Image as KonvaImage, Text, Group } from 'react-konva'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { RotateCw, RefreshCw, Check } from 'lucide-react'
import type {
  SpreadInstance,
  SpreadTemplate,
  PhotoPlaceholder,
  TextPlaceholder,
  DecorationPlaceholder,
  RenderPlaceholder,
} from '@/lib/album-builder/types'
import {
  computeCrop,
  parseScale,
  parseOffset,
  parseRotate,
  computeAutoZoomForRotation,
  hasCustomTransform,
  serializeScale,
  serializeOffset,
  serializeRotate,
  SCALE_MIN,
  SCALE_MAX,
  OFFSET_MIN,
  OFFSET_MAX,
  ROTATE_MIN,
  ROTATE_MAX,
} from '@/lib/photo-transform'
import {
  parseBalanceOverrides,
  applyBalanceOverrides,
} from '@/lib/balance-overrides'
import { orderPlaceholdersForRender } from '@/lib/decorations/render-order'
import { resolvePlaceholdersForSide } from '@/lib/album-builder/mirror-placeholders'
import {
  parseFontSizeMult,
  parseColor,
  detectTextStyleGroup,
  resolveFontSizeMult,
  resolveColor,
  parseHAlign,
  parseVAlign,
  resolveHAlign,
  resolveVAlign,
  parseFontFamily,
  resolveFontFamily,
  type AlbumTextStyleOverrides,
} from '@/lib/text-style'

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
  onTextClick?: (label: string, currentValue: string | null, rightEdge: number, topEdge: number, leftEdge: number, instanceKey: number) => void
  onTextSubmit?: (label: string, newValue: string | null) => void
  onTextCancel?: () => void
  // Л.2 — контекстное меню на photo placeholder (правый клик).
  // Parent получает label, текущий url, и координаты клика для позиционирования popover.
  onPhotoContextMenu?: (label: string, url: string | null, clientX: number, clientY: number) => void
  // КЭ.5 — одинарный левый клик на photo placeholder. Открывает
  // интерактивный кроп на холсте (scale + offset). dnd-kit
  // отменяет click при движении мыши, так что drag не триггерит этот
  // handler. Срабатывает только при url != null (нет смысла кадрировать
  // пустой слот).
  onPhotoClick?: (label: string, url: string, rightEdge: number, topEdge: number, leftEdge: number, instanceKey: number) => void
  // Прототип балансировки — переопределение координат и видимости placeholder'ов.
  // Если placeholder есть в этой map с hidden=true — не рендерится вообще.
  // Если есть с x_mm/y_mm — рендерится по новым координатам.
  // Размеры (width_mm/height_mm) НЕ меняются.
  placeholderOverrides?: Record<string, { hidden?: boolean; x_mm?: number; y_mm?: number }>
  // РЭ.53: глобальные стили текстов (size + color по группам).
  // Применяются как fallback когда нет точечного __fontSize__/__color__.
  // Default {} — нет глобальных стилей.
  textStyleOverrides?: AlbumTextStyleOverrides
  // Фоновое изображение набора (template_sets.default_background_url),
  // public URL уже собран. Рендерится первым слоем под placeholder'ами.
  // null = без фона (текущее поведение).
  backgroundUrl?: string | null
  // Какая часть фона показывается на этом канвасе:
  // - 'spread' (двустраничный мастер) — картинка тянется на template.width_mm
  // - 'left'  — картинка шириной 2× template.width_mm, x=0 (видна левая половина)
  // - 'right' — картинка шириной 2× template.width_mm, x=-template.width_mm
  // Default 'spread' для обратной совместимости (можно опускать).
  pageSide?: 'spread' | 'left' | 'right'
  // Блок UX.3 — интерактивный кроп на холсте. Если задан label, над этим
  // фото показывается PhotoCropOverlay (полный исходник + жесты), Konva-копия
  // и DropZone для него скрываются, остальной канвас затемняется. Колбэки в
  // cropHandlers пишут тот же формат трансформа. Только в mode==='edit'.
  croppingLabel?: string | null
  cropHandlers?: CropHandlers
  // Модель «поля» (template_sets.spine_margin_mm): отступ контента от корешка
  // в мм. null/undefined = legacy авто-зеркало page-any. Задан = система ставит
  // блок с этим полем у корешка (см. resolvePlaceholdersForSide). Один на набор.
  spineMarginMm?: number | null
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

// ─── Фоновое изображение набора ───────────────────────────────────────────
//
// Рисует default_background_url разворота под placeholder'ами.
// Для одностраничного мастера картинка тянется на 2× ширины страницы:
// - pageSide='left'  → x=0,                видна левая половина
// - pageSide='right' → x=-pageWidthMm,     видна правая половина
// Stage обрезает то, что выходит за template.width_mm.
// Для is_spread (pageSide='spread') картинка ровно по ширине разворота.
function SpreadBackgroundLayer({
  url,
  pageWidthMm,
  pageHeightMm,
  pageSide,
}: {
  url: string
  pageWidthMm: number
  pageHeightMm: number
  pageSide: 'spread' | 'left' | 'right'
}) {
  const img = useImage(url)
  if (!img) return null

  const isSpread = pageSide === 'spread'
  const drawWidth = isSpread ? pageWidthMm : pageWidthMm * 2
  const drawX = pageSide === 'right' ? -pageWidthMm : 0

  // «cover»: вписываем фон в бокс разворота с СОХРАНЕНИЕМ пропорций, лишнее
  // обрезаем по центру (crop в исходных пикселях картинки). Без этого Konva
  // растягивала картинку под бокс (stretch) и при несовпадении пропорций
  // картинки и разворота фон деформировался.
  const imgW = img.naturalWidth || img.width
  const imgH = img.naturalHeight || img.height
  let crop:
    | { x: number; y: number; width: number; height: number }
    | undefined
  if (imgW > 0 && imgH > 0) {
    const boxAspect = drawWidth / pageHeightMm
    const imgAspect = imgW / imgH
    if (imgAspect > boxAspect) {
      // Картинка шире бокса → обрезаем по бокам.
      const cropW = imgH * boxAspect
      crop = { x: (imgW - cropW) / 2, y: 0, width: cropW, height: imgH }
    } else {
      // Картинка выше бокса → обрезаем сверху/снизу.
      const cropH = imgW / boxAspect
      crop = { x: 0, y: (imgH - cropH) / 2, width: imgW, height: cropH }
    }
  }

  return (
    <KonvaImage
      image={img}
      x={drawX}
      y={0}
      width={drawWidth}
      height={pageHeightMm}
      crop={crop}
      listening={false}
    />
  )
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
  // Часть 2 ТЗ: скруглённые углы рамки (corner_radius_mm). 0 = прямые углы
  // (regression-safe для обычных фото). Применяется к пустому слоту и к
  // прямоугольному (не повёрнутому) фото.
  const cornerRadius = placeholder.corner_radius_mm ?? 0
  // Часть 2 ТЗ (6б): внешнее свечение (дымка) вокруг фото. Цвет подобран при
  // загрузке из доминирующего цвета привязанного декора (glow_color). Без
  // цвета/размера эффект выключен (regression-safe). Размер pt → mm.
  const hasGlow =
    !!placeholder.glow_color &&
    !!placeholder.glow_size_pt &&
    placeholder.glow_size_pt > 0
  const glowProps = hasGlow
    ? {
        shadowColor: placeholder.glow_color as string,
        shadowBlur: (placeholder.glow_size_pt as number) * PT_TO_MM,
        shadowOpacity: 0.85,
      }
    : {}

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
        cornerRadius={cornerRadius}
        {...glowProps}
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
        cornerRadius={cornerRadius}
        {...glowProps}
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

// ─── DecorationSlot (привязанный декор, Часть 1 ТЗ) ─────────────────────────
// Статичная картинка декора (рамка-теремок, ленточка). Рисуется в рамке
// плейсхолдера, как дизайнер задал в IDML. Скрытие/смещение уже применены в
// applyBalanceOverrides + orderPlaceholdersForRender ДО рендера — сюда приходит
// видимый декор с финальной геометрией. Поворот — вокруг центра рамки.
function DecorationSlot({ placeholder }: { placeholder: DecorationPlaceholder }) {
  const url = placeholder.url ?? ''
  const img = useImage(url || null)
  if (!url || !img) return null

  const w = placeholder.width_mm
  const h = placeholder.height_mm
  const rotation = placeholder.rotation_deg ?? 0

  return (
    <KonvaImage
      image={img}
      x={placeholder.x_mm + w / 2}
      y={placeholder.y_mm + h / 2}
      width={w}
      height={h}
      offsetX={w / 2}
      offsetY={h / 2}
      rotation={rotation}
      listening={false}
    />
  )
}

// ─── Text placeholder ─────────────────────────────────────────────────────
function TextSlot({
  placeholder,
  value,
  fontSizeMult = 1,
  colorOverride = null,
  hAlignOverride = null,
  vAlignOverride = null,
  fontFamilyOverride = null,
}: {
  placeholder: TextPlaceholder
  value: string | null
  // Р.3 — override стиля. Default (1.0, null) → используется placeholder.color
  // и placeholder.font_size_pt (regression-safe).
  fontSizeMult?: number
  colorOverride?: string | null
  // РЭ.54: align overrides. null → fallback на placeholder.align (горизонталь)
  // или 'top' (вертикаль, текущий хардкод).
  hAlignOverride?: 'left' | 'center' | 'right' | null
  vAlignOverride?: 'top' | 'middle' | 'bottom' | null
  // РЭ.55: семейство шрифта (из curated AVAILABLE_FONTS). null →
  // fallback на placeholder.font_family из IDML.
  fontFamilyOverride?: string | null
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
  // РЭ.54: align — override побеждает; иначе placeholder.align (для H).
  // Для вертикали: override → vertical_align из IDML (VerticalJustification) → 'top'.
  // Раньше хардкодили 'top' — центрированные цитаты прижимались к верху фрейма.
  const finalHAlign = hAlignOverride ?? placeholder.align
  const finalVAlign = vAlignOverride ?? placeholder.vertical_align ?? 'top'
  // РЭ.55: шрифт — override побеждает; иначе placeholder.font_family.
  const finalFontFamily = fontFamilyOverride ?? placeholder.font_family
  // РЭ.55: rotation_deg из IDML (±90° или 0). Канва игнорировала это
  // поле — текст рисовался горизонтально несмотря на вертикальный фрейм
  // в макете. Логика поворота:
  //   • Placeholder в БД хранит ВИЗУАЛЬНЫЙ bbox (x_mm, y_mm, width_mm,
  //     height_mm) — то что партнёр видит на странице ПОСЛЕ поворота.
  //     Для повёрнутого на 90° фрейма width_mm — это узкая сторона.
  //   • Konva рисует <Text> в нерёповёрнутой системе. Чтобы текст после
  //     rotation попал в визуальный bbox, передаём width/height с
  //     перестановкой и подбираем точку привязки.
  //   • rotation = -90 (CW): text «течёт» из (x, y) вверх-вправо →
  //     ставим (x, y) в нижний-левый угол bbox, width=height_mm,
  //     height=width_mm.
  //   • rotation = +90 (CCW): «течёт» вниз-влево → ставим (x, y) в
  //     верхний-правый угол bbox, width/height тоже переставлены.
  //   • rotation = 0 (или undefined): рисуем как раньше.
  // PDF-export уже работает с rotation_deg (lib/pdf-export/text-shaping.ts);
  // мы выравниваем поведение canvas с ним.
  // Часть 3 ТЗ: текстовые эффекты (обводка + свечение) для читаемости на
  // пёстром фоне. Поля опциональны — у старых мастеров отсутствуют (нет эффекта).
  const hasStroke =
    !!placeholder.text_stroke_color &&
    !!placeholder.text_stroke_width_pt &&
    placeholder.text_stroke_width_pt > 0
  const hasGlow =
    !!placeholder.text_glow_color &&
    !!placeholder.text_glow_blur_pt &&
    placeholder.text_glow_blur_pt > 0
  const rotationDeg = placeholder.rotation_deg ?? 0
  let renderX = placeholder.x_mm
  let renderY = placeholder.y_mm
  let renderWidth = placeholder.width_mm
  let renderHeight = placeholder.height_mm
  if (rotationDeg === -90) {
    renderX = placeholder.x_mm
    renderY = placeholder.y_mm + placeholder.height_mm
    renderWidth = placeholder.height_mm
    renderHeight = placeholder.width_mm
  } else if (rotationDeg === 90) {
    renderX = placeholder.x_mm + placeholder.width_mm
    renderY = placeholder.y_mm
    renderWidth = placeholder.height_mm
    renderHeight = placeholder.width_mm
  }
  return (
    <Text
      x={renderX}
      y={renderY}
      width={renderWidth}
      height={renderHeight}
      rotation={rotationDeg}
      text={value}
      fontSize={placeholder.font_size_pt * PT_TO_MM * fontSizeMult}
      fontFamily={`${finalFontFamily}, serif`}
      fontStyle={fontStyle}
      fill={finalColor}
      align={finalHAlign}
      verticalAlign={finalVAlign}
      // Часть 3 ТЗ: обводка букв. fillAfterStrokeEnabled — заливка поверх
      // обводки (контур по краю буквы, не перекрывает её).
      {...(hasStroke
        ? {
            stroke: placeholder.text_stroke_color!,
            strokeWidth: placeholder.text_stroke_width_pt! * PT_TO_MM,
            fillAfterStrokeEnabled: true,
          }
        : {})}
      // Часть 3 ТЗ: свечение/тень — Konva shadow без смещения.
      {...(hasGlow
        ? {
            shadowColor: placeholder.text_glow_color!,
            shadowBlur: placeholder.text_glow_blur_pt! * PT_TO_MM,
            shadowOpacity: 0.9,
          }
        : {})}
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
  // РЭ.52.c: rightEdge/topEdge/leftEdge — границы placeholder'а
  // (не точка клика). Используется в parent'е для позиционирования
  // TextStylePanel ВПЛОТНУЮ к границе текста, не перекрывая его.
  onClick: (rightEdge: number, topEdge: number, leftEdge: number) => void
}) {
  return (
    <div
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        onClick(rect.right, rect.top, rect.left)
      }}
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
  hAlignOverride = null,
  vAlignOverride = null,
  fontFamilyOverride = null,
  onSubmit,
  onCancel,
}: {
  placeholder: TextPlaceholder
  scale: number
  initialValue: string | null
  /** Р.3 — override размера (мультипликатор) и цвета. Default (1, null). */
  fontSizeMult?: number
  colorOverride?: string | null
  /** РЭ.54: override выравнивания. null → placeholder.align / 'top'. */
  hAlignOverride?: 'left' | 'center' | 'right' | null
  vAlignOverride?: 'top' | 'middle' | 'bottom' | null
  /** РЭ.55: override шрифта. null → placeholder.font_family из IDML. */
  fontFamilyOverride?: string | null
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

  // РЭ.54: финальные align значения. Точка → fallback на placeholder/'top'.
  const finalHAlign = hAlignOverride ?? placeholder.align
  const finalVAlign = vAlignOverride ?? 'top'
  // РЭ.55: финальный шрифт. Override побеждает; иначе placeholder.font_family.
  const finalFontFamily = fontFamilyOverride ?? placeholder.font_family

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

  // РЭ.54.f: textarea оборачивается в flex-контейнер, чтобы
  // поддерживать вертикальное выравнивание. Сам <textarea> не
  // поддерживает vertical-align внутри своего box, но flex-контейнер
  // умеет выравнивать ребёнка. Высота textarea адаптивна — мы её
  // динамически устанавливаем по scrollHeight (см. useEffect ниже).
  const wrapperAlignItems =
    finalVAlign === 'middle' ? 'center' : finalVAlign === 'bottom' ? 'flex-end' : 'flex-start'

  // Auto-resize textarea по контенту — для valign middle/bottom это
  // принципиально (если textarea растянется на всю height фрейма,
  // visual alignment не сработает). Запускаем после каждой смены value.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Сброс — иначе scrollHeight будет ограничен текущей высотой.
    el.style.height = 'auto'
    // scrollHeight = реальная высота контента. Прибавляем 2px для
    // защиты от cut-off при line-height = 1 (некоторые шрифты дают
    // descender'ы которые могут немного выходить за scrollHeight).
    const contentH = el.scrollHeight + 2
    // Не растягиваем больше чем фрейм.
    const frameH = placeholder.height_mm * scale
    el.style.height = `${Math.min(contentH, frameH)}px`
  }, [value, scale, placeholder.height_mm, fontSizePx])

  return (
    <div
      className="absolute pointer-events-auto"
      style={{
        left: `${placeholder.x_mm * scale}px`,
        top: `${placeholder.y_mm * scale}px`,
        width: `${placeholder.width_mm * scale}px`,
        height: `${placeholder.height_mm * scale}px`,
        display: 'flex',
        alignItems: wrapperAlignItems,
        // Рамка показывает границы фрейма. Перенесена с textarea на
        // wrapper — чтобы partner видел реальный bounding box даже
        // когда сама textarea меньше высоты фрейма (valign middle/bottom).
        border: '2px solid #3b82f6',
        boxSizing: 'border-box',
        zIndex: 30,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          // height задаётся динамически через useEffect выше.
          fontFamily: `${finalFontFamily}, serif`,
          fontSize: `${fontSizePx}px`,
          fontWeight: fontStyle === 'bold' ? 700 : 400,
          color,
          textAlign: finalHAlign,
          padding: 0,
          margin: 0,
          border: 'none',
          outline: 'none',
          background: 'rgba(255, 255, 255, 0.92)',
          resize: 'none',
          overflow: 'hidden',
          // line-height: Konva по дефолту использует lineHeight=1 (без
          // дополнительного межстрочного промежутка). Для textarea
          // ставим то же.
          lineHeight: 1,
          boxSizing: 'border-box',
          display: 'block',
        }}
      />
    </div>
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
  // РЭ.52.c: передаются rect.right, rect.top, rect.left (вместо clientX/Y)
  // чтобы parent мог позиционировать panel ВПЛОТНУЮ к границе фото.
  // РЭ.54.d: callback также получает instanceKey — parent (page.tsx)
  // нужно знать какой spread_index активировать (если клик пришёл с
  // другой страницы разворота, чем currentIdx).
  onClick?: (label: string, url: string, rightEdge: number, topEdge: number, leftEdge: number, instanceKey: number) => void
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
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        // instanceKey в DropZone Props — string|number; здесь
        // конвертируем в number (для spread_index всегда number).
        const ikNum = typeof instanceKey === 'number' ? instanceKey : Number(instanceKey)
        onClick(placeholder.label, url, rect.right, rect.top, rect.left, ikNum)
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

// ─── Интерактивный кроп на холсте (Блок UX.3) ──────────────────────────────
// Набор колбэков, которыми оверлей кропа общается с редактором (page.tsx).
export type CropHandlers = {
  // Записать новый трансформ (те же сериализованные ключи, что у панели).
  onChange: (updates: {
    scale?: string | null
    offset?: string | null
    rotate?: string | null
  }) => void
  // Завершить кроп (кнопка «Готово», клик по затемнению, Esc).
  onClose: () => void
  // Обрамляют один непрерывный жест — чтобы он стал ОДНИМ шагом undo.
  onGestureStart: () => void
  onGestureEnd: () => void
}

// PhotoCropOverlay — DOM-оверлей над фото-плейсхолдером. Показывает полный
// исходник: яркая часть внутри рамки = текущий кроп (1:1 с Konva/PDF),
// тусклая за рамкой = что обрезается. Жесты: тащить = pan (offset),
// угловые маркеры/колесо = zoom (scale), верхняя ручка = поворот (rotate).
// Формат трансформа НЕ меняется — пишем те же __scale__/__offset__/__rotate__
// через handlers.onChange, поэтому готовые макеты и серверный PDF-рендер
// не ломаются.
function PhotoCropOverlay({
  placeholder,
  scale,
  url,
  transform,
  handlers,
}: {
  placeholder: PhotoPlaceholder
  scale: number
  url: string
  transform: { scale: number; offsetX: number; offsetY: number; rotateDeg: number }
  handlers: CropHandlers
}) {
  const img = useImage(url)
  const containerRef = useRef<HTMLDivElement>(null)
  // Живые снимки — чтобы window-listener'ы жестов не залипали на устаревшем
  // замыкании при ререндерах.
  const tRef = useRef(transform)
  tRef.current = transform
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const frameW = placeholder.width_mm * scale
  const frameH = placeholder.height_mm * scale
  const frameLeft = placeholder.x_mm * scale
  const frameTop = placeholder.y_mm * scale
  const targetRatio = placeholder.width_mm / placeholder.height_mm

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(v, lo), hi)

  // Отправить новый полный трансформ (все три поля; default → null удаляет
  // ключ, как делает панель).
  const emit = (nx: { s: number; ox: number; oy: number; rot: number }) => {
    handlersRef.current.onChange({
      scale: Math.abs(nx.s - 1) < 1e-4 ? null : serializeScale(nx.s),
      offset:
        Math.abs(nx.ox) < 1e-4 && Math.abs(nx.oy) < 1e-4
          ? null
          : serializeOffset(nx.ox, nx.oy),
      rotate: Math.abs(nx.rot) < 1e-4 ? null : serializeRotate(nx.rot),
    })
  }

  const frameCenterClient = () => {
    const r = containerRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  // Универсальный запуск жеста с window-listener'ами и коалесингом undo.
  const runGesture = (
    onMove: (ev: PointerEvent) => void,
  ) => {
    handlersRef.current.onGestureStart()
    const move = (ev: PointerEvent) => onMove(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      handlersRef.current.onGestureEnd()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // PAN — перетаскивание исходника. Экранную дельту разворачиваем в локальные
  // оси изображения (−θ), делим на эффективный масштаб → дельта offset.
  const startPan = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const nW = img?.naturalWidth ?? 0
    const nH = img?.naturalHeight ?? 0
    if (nW <= 0 || nH <= 0) return
    const start = { ...tRef.current }
    const sx = e.clientX
    const sy = e.clientY
    const cp = computeCrop(nW, nH, targetRatio, start.scale, start.offsetX, start.offsetY)
    const dispScale = cp.cropW > 0 ? frameW / cp.cropW : 1
    const autoZoom = computeAutoZoomForRotation(start.rotateDeg, targetRatio)
    const remW = nW - cp.cropW
    const remH = nH - cp.cropH
    const theta = (start.rotateDeg * Math.PI) / 180
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    runGesture((ev) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      const localDX = dx * cos + dy * sin
      const localDY = -dx * sin + dy * cos
      const dox = remW > 0 ? (-2 * localDX) / (dispScale * autoZoom * remW) : 0
      const doy = remH > 0 ? (-2 * localDY) / (dispScale * autoZoom * remH) : 0
      emit({
        s: start.scale,
        ox: clamp(start.offsetX + dox, OFFSET_MIN, OFFSET_MAX),
        oy: clamp(start.offsetY + doy, OFFSET_MIN, OFFSET_MAX),
        rot: start.rotateDeg,
      })
    })
  }

  // ZOOM — угловой маркер. Масштаб ∝ расстоянию указателя от центра рамки.
  const startZoom = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = { ...tRef.current }
    const c = frameCenterClient()
    const startDist = Math.hypot(e.clientX - c.x, e.clientY - c.y) || 1
    runGesture((ev) => {
      const d = Math.hypot(ev.clientX - c.x, ev.clientY - c.y)
      const s = clamp((start.scale * d) / startDist, SCALE_MIN, SCALE_MAX)
      emit({ s, ox: start.offsetX, oy: start.offsetY, rot: start.rotateDeg })
    })
  }

  // ROTATE — верхняя ручка. Дельта угла указателя вокруг центра рамки.
  const startRotate = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const start = { ...tRef.current }
    const c = frameCenterClient()
    const startAngle = Math.atan2(e.clientY - c.y, e.clientX - c.x)
    runGesture((ev) => {
      const a = Math.atan2(ev.clientY - c.y, ev.clientX - c.x)
      const deltaDeg = ((a - startAngle) * 180) / Math.PI
      const rot = clamp(start.rotateDeg + deltaDeg, ROTATE_MIN, ROTATE_MAX)
      emit({ s: start.scale, ox: start.offsetX, oy: start.offsetY, rot })
    })
  }

  // Колесо = zoom вокруг центра (один шаг = одно изменение).
  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const cur = tRef.current
    const factor = e.deltaY < 0 ? 1.06 : 0.94
    const s = clamp(cur.scale * factor, SCALE_MIN, SCALE_MAX)
    emit({ s, ox: cur.offsetX, oy: cur.offsetY, rot: cur.rotateDeg })
  }

  const reset = () => {
    handlersRef.current.onGestureStart()
    emit({ s: 1, ox: 0, oy: 0, rot: 0 })
    handlersRef.current.onGestureEnd()
  }
  const nW = img?.naturalWidth ?? 0
  const nH = img?.naturalHeight ?? 0
  const ready = nW > 0 && nH > 0
  const cp = ready
    ? computeCrop(nW, nH, targetRatio, transform.scale, transform.offsetX, transform.offsetY)
    : null
  const dispScale = cp && cp.cropW > 0 ? frameW / cp.cropW : 1
  const autoZoom = computeAutoZoomForRotation(transform.rotateDeg, targetRatio)
  const groupStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    transform: `rotate(${transform.rotateDeg}deg) scale(${autoZoom})`,
    transformOrigin: 'center center',
    pointerEvents: 'none',
  }
  const imgStyle: CSSProperties = {
    position: 'absolute',
    left: `${cp ? -cp.cropX * dispScale : 0}px`,
    top: `${cp ? -cp.cropY * dispScale : 0}px`,
    width: `${nW * dispScale}px`,
    height: `${nH * dispScale}px`,
    maxWidth: 'none',
    pointerEvents: 'none',
  }

  // Скругление окна кропа: круглый портрет (учителя) → эллипс, иначе
  // corner_radius_mm рамки (обычно 0). Чтобы превью совпадало с Konva/PDF.
  const clipRadius = placeholder.is_circle
    ? '50%'
    : `${(placeholder.corner_radius_mm ?? 0) * scale}px`

  const corners: { key: string; cur: string; pos: CSSProperties }[] = [
    { key: 'nw', cur: 'nwse-resize', pos: { left: -7, top: -7 } },
    { key: 'ne', cur: 'nesw-resize', pos: { right: -7, top: -7 } },
    { key: 'sw', cur: 'nesw-resize', pos: { left: -7, bottom: -7 } },
    { key: 'se', cur: 'nwse-resize', pos: { right: -7, bottom: -7 } },
  ]

  return (
    <div
      ref={containerRef}
      // pointer-events-auto ОБЯЗАТЕЛЕН: родительский DOM-overlay —
      // pointer-events-none, без этого весь кроп «мёртвый» (не тащится,
      // кнопки не жмутся).
      className="absolute pointer-events-auto"
      style={{
        left: `${frameLeft}px`,
        top: `${frameTop}px`,
        width: `${frameW}px`,
        height: `${frameH}px`,
        touchAction: 'none',
      }}
    >
      {/* Тусклый полный исходник — контекст «что обрезается» (вылезает за рамку) */}
      <div className="absolute inset-0" style={{ overflow: 'visible' }}>
        <div style={groupStyle}>
          {ready && (
            <img src={url} alt="" draggable={false} style={{ ...imgStyle, opacity: 0.35 }} />
          )}
        </div>
      </div>
      {/* Яркий кроп внутри рамки — WYSIWYG с Konva/PDF */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ borderRadius: clipRadius }}
      >
        <div style={groupStyle}>
          {ready && <img src={url} alt="" draggable={false} style={imgStyle} />}
        </div>
      </div>

      {/* Поверхность перетаскивания (pan) + колесо (zoom) */}
      <div
        className="absolute inset-0 cursor-move"
        style={{ touchAction: 'none' }}
        onPointerDown={startPan}
        onWheel={onWheel}
      />

      {/* Сетка третей */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/40" />
        <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/40" />
        <div className="absolute top-1/3 left-0 right-0 h-px bg-white/40" />
        <div className="absolute top-2/3 left-0 right-0 h-px bg-white/40" />
      </div>

      {/* Рамка-окно */}
      <div
        className="absolute inset-0 pointer-events-none ring-2 ring-white"
        style={{ borderRadius: clipRadius }}
      />

      {/* Угловые маркеры — zoom */}
      {corners.map((c) => (
        <div
          key={c.key}
          onPointerDown={startZoom}
          className="absolute w-3.5 h-3.5 bg-white border border-neutral-400 rounded-sm shadow"
          style={{ cursor: c.cur, ...c.pos }}
        />
      ))}

      {/* Стержень + ручка поворота */}
      <div className="absolute left-1/2 -top-4 w-px h-4 -translate-x-1/2 bg-white/70 pointer-events-none" />
      <div
        onPointerDown={startRotate}
        className="absolute left-1/2 -top-9 -translate-x-1/2 w-6 h-6 bg-white border border-neutral-400 rounded-full shadow cursor-grab flex items-center justify-center"
        title="Повернуть"
      >
        <RotateCw size={13} className="text-neutral-600" />
      </div>

      {/* Тулбар: сброс / готово */}
      <div
        className="absolute left-1/2 -bottom-12 -translate-x-1/2 flex items-center gap-1 bg-neutral-900/90 rounded-lg px-1.5 py-1 shadow-lg whitespace-nowrap"
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white/90 hover:bg-white/15 rounded"
          title="Сбросить кадрирование"
        >
          <RefreshCw size={13} /> Сброс
        </button>
        <button
          type="button"
          onClick={() => handlersRef.current.onClose()}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-900 bg-white hover:bg-white/90 rounded"
          title="Завершить кадрирование"
        >
          <Check size={13} /> Готово
        </button>
      </div>
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
  textStyleOverrides,
  backgroundUrl,
  pageSide = 'spread',
  croppingLabel,
  cropHandlers,
  spineMarginMm,
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

  // Авто-зеркало page-any на правой странице (mirror-placeholders.ts) —
  // ФИНАЛЬНАЯ геометрическая трансформация ПОСЛЕ балансировки. Считаем ОДИН
  // раз и используем у ВСЕХ потребителей координат (Konva-слоты + DOM-оверлеи
  // DropZone/PhotoCropOverlay) — иначе drag/crop разойдутся со слотами на
  // правой странице. Та же точка/условие, что в PDF-pipeline → превью = PDF.
  // Для левой/spread и не-page-any мастеров возвращает список как есть.
  const renderPlaceholders = resolvePlaceholdersForSide(
    effectiveTemplate.placeholders as RenderPlaceholder[],
    pageSide,
    template.page_type,
    template.width_mm,
    spineMarginMm ?? null,
  )

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

          {/* Фоновое изображение набора (default_background_url).
              Для одностраничного мастера картинка — это разворот целиком,
              видна только своя половина (Stage обрезает по template.width_mm).
              Для is_spread мастера картинка ровно по ширине разворота. */}
          {backgroundUrl && (
            <SpreadBackgroundLayer
              url={backgroundUrl}
              pageWidthMm={template.width_mm}
              pageHeightMm={template.height_mm}
              pageSide={pageSide}
            />
          )}

          {/* Контент из instance.data.
              Часть 1 ТЗ: сортируем z-порядок — __under перед базой, __over
              после (orderPlaceholdersForRender). Скрытый декор уже отфильтрован
              в applyBalanceOverrides выше. */}
          {orderPlaceholdersForRender(renderPlaceholders).map((p: RenderPlaceholder, i) => {
            const value = instance.data[p.label] ?? null
            const key = `${p.label}-${i}`
            if (p.type === 'decoration') {
              return <DecorationSlot key={key} placeholder={p} />
            }
            if (p.type === 'photo') {
              // Скрываем Konva-копию фото на время drag — preview
              // отрисовывается через DOM-overlay в DropZone (CSS transform).
              // Блок UX.3 — на время кропа фото рисует PhotoCropOverlay.
              if (draggingLabel === p.label) return null
              if (croppingLabel === p.label) return null
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
              // РЭ.53: каскад глобальный (по группе) → точечный.
              // Точка побеждает (если есть); иначе fallback на группу.
              const pointMult = instance.data[`__fontSize__${p.label}`]
                ? parseFontSizeMult(instance.data[`__fontSize__${p.label}`])
                : null
              const pointColor = parseColor(instance.data[`__color__${p.label}`])
              // РЭ.54: align overrides.
              const pointHAlign = parseHAlign(instance.data[`__halign__${p.label}`])
              const pointVAlign = parseVAlign(instance.data[`__valign__${p.label}`])
              // РЭ.55: font override.
              const pointFontFamily = parseFontFamily(instance.data[`__font__${p.label}`])
              const group = detectTextStyleGroup(p.label)
              const groupOv = group ? textStyleOverrides?.[group] : null
              // resolveFontSizeMult: point !== null → point; иначе group/100; иначе 1.
              // parseFontSizeMult возвращает 1 для пустых значений, поэтому
              // мы и проверяем НАЛИЧИЕ ключа отдельно (через truthy data[key]).
              const fsMult = resolveFontSizeMult(pointMult, groupOv ?? null)
              const colorOv = resolveColor(pointColor, groupOv ?? null)
              const hAlignOv = resolveHAlign(pointHAlign, groupOv ?? null)
              const vAlignOv = resolveVAlign(pointVAlign, groupOv ?? null)
              const fontFamilyOv = resolveFontFamily(pointFontFamily, groupOv ?? null)
              return (
                <TextSlot
                  key={key}
                  placeholder={p}
                  value={value}
                  fontSizeMult={fsMult}
                  colorOverride={colorOv}
                  hAlignOverride={hAlignOv}
                  vAlignOverride={vAlignOv}
                  fontFamilyOverride={fontFamilyOv}
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
          {renderPlaceholders.map((p) => {
            if (p.type === 'photo') {
              // Блок UX.3 — фото в режиме кропа обслуживает PhotoCropOverlay
              // (рендерится ниже, поверх затемнения), DropZone скрываем.
              if (croppingLabel === p.label) return null
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
              // РЭ.56: ключ отсутствует в instance.data → используем
              // default_text из placeholder (декоративный текст из IDML).
              // Ключ есть но null/'' → партнёр явно очистил, default_text
              // не применяем. Это отличает «не задано» от «явно стёрто».
              const value =
                p.label in instance.data
                  ? (instance.data[p.label] ?? null)
                  : p.default_text ?? null
              // Когда этот text-placeholder редактируется — рендерим
              // textarea-editor. Иначе — прозрачный кликабельный DropZone
              // с cursor:text и hover ring.
              if (editingTextLabel === p.label) {
                // Р.3 — те же overrides из data что и TextSlot.
                // РЭ.53: каскад глобал → точка.
                const pointMult = instance.data[`__fontSize__${p.label}`]
                  ? parseFontSizeMult(instance.data[`__fontSize__${p.label}`])
                  : null
                const pointColor = parseColor(instance.data[`__color__${p.label}`])
                // РЭ.54: align overrides.
                const pointHAlign = parseHAlign(instance.data[`__halign__${p.label}`])
                const pointVAlign = parseVAlign(instance.data[`__valign__${p.label}`])
                // РЭ.55: font override.
                const pointFontFamily = parseFontFamily(instance.data[`__font__${p.label}`])
                const group = detectTextStyleGroup(p.label)
                const groupOv = group ? textStyleOverrides?.[group] : null
                const fsMult = resolveFontSizeMult(pointMult, groupOv ?? null)
                const colorOv = resolveColor(pointColor, groupOv ?? null)
                const hAlignOv = resolveHAlign(pointHAlign, groupOv ?? null)
                const vAlignOv = resolveVAlign(pointVAlign, groupOv ?? null)
                const fontFamilyOv = resolveFontFamily(pointFontFamily, groupOv ?? null)
                return (
                  <TextInlineEditor
                    key={`text-edit-${p.label}`}
                    placeholder={p}
                    scale={scale}
                    initialValue={value}
                    fontSizeMult={fsMult}
                    colorOverride={colorOv}
                    hAlignOverride={hAlignOv}
                    vAlignOverride={vAlignOv}
                    fontFamilyOverride={fontFamilyOv}
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
                  onClick={(rx, ty, lx) => onTextClick?.(p.label, value, rx, ty, lx, instance.spread_index)}
                />
              )
            }
            return null
          })}

          {/* Блок UX.3 — затемнение + интерактивный кроп. Затемнение поверх
              всех DropZone'ов (блокирует прочие клики на время кропа), клик
              по нему = «Готово». PhotoCropOverlay — поверх затемнения. */}
          {croppingLabel && cropHandlers && (() => {
            const cp = renderPlaceholders.find(
              (pl) => pl.label === croppingLabel && pl.type === 'photo',
            ) as PhotoPlaceholder | undefined
            const cu = cp ? (instance.data[cp.label] ?? null) : null
            if (!cp || !cu) return null
            const sc = parseScale(instance.data[`__scale__${cp.label}`])
            const [ox, oy] = parseOffset(instance.data[`__offset__${cp.label}`])
            const rot = parseRotate(instance.data[`__rotate__${cp.label}`])
            return (
              <>
                <div
                  className="absolute inset-0 bg-black/55 pointer-events-auto"
                  onClick={() => cropHandlers.onClose()}
                />
                <PhotoCropOverlay
                  placeholder={cp}
                  scale={scale}
                  url={cu}
                  transform={{ scale: sc, offsetX: ox, offsetY: oy, rotateDeg: rot }}
                  handlers={cropHandlers}
                />
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
