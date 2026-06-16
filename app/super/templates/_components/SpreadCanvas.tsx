'use client'

import { Stage, Layer, Rect, Label, Tag, Text } from 'react-konva'
import type { SpreadTemplate } from './types'
import { PLACEHOLDER_COLORS, PLACEHOLDER_COLOR_FALLBACK } from './colors'

// Цвет плейсхолдера по типу с фолбэком — неизвестный тип (напр. decoration в
// дизайнерских наборах) НЕ должен ронять превью-канвас целиком.
const colorFor = (type: string) =>
  PLACEHOLDER_COLORS[type as keyof typeof PLACEHOLDER_COLORS] ??
  PLACEHOLDER_COLOR_FALLBACK

type Props = {
  spread: SpreadTemplate
  containerWidth: number
  // Для миниатюр (0.8.4): listening=false убирает hit-graph и второй canvas
  // (~50% памяти), pixelRatio=1 убирает retina-апскейл (миниатюра 250px не
  // нуждается в ретина-резкости). Для full-size — оставлять default.
  listening?: boolean
  pixelRatio?: number
  // showLabels=false скрывает подписи плейсхолдеров (для миниатюр, где
  // fontSize=11/scale становится крупным на маленьком canvas и подписи
  // накладываются — F-Head-LargeGrid и т.п.). Default true сохраняет
  // поведение full-size модалки (с подписями).
  showLabels?: boolean
}

export default function SpreadCanvas({ spread, containerWidth, listening, pixelRatio, showLabels = true }: Props) {
  const scale = containerWidth / spread.width_mm
  const stageWidth = spread.width_mm * scale
  const stageHeight = spread.height_mm * scale
  // Scale-aware размеры для подписей: целевые 11px / 1.5px / 0.5px visual
  // независимо от размера spread'а (двойного 452mm или одностраничного 226mm).
  const labelFontMm = 11 / scale
  const labelPaddingMm = 1.5 / scale
  const cornerRadiusMm = 0.5 / scale

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      scaleX={scale}
      scaleY={scale}
      listening={listening ?? true}
      pixelRatio={pixelRatio}
    >
      <Layer>
        {/* Фон spread'а — тонкая граница для отделения от страницы */}
        <Rect
          x={0}
          y={0}
          width={spread.width_mm}
          height={spread.height_mm}
          fill="#fafafa"
          stroke="#e5e7eb"
          strokeWidth={0.3}
        />
        {/* Bbox каждого плейсхолдера. Axis-aligned (rotation_deg игнорируется
            в 0.8.x — см. project_phase0_parser_followups.md). */}
        {spread.placeholders.map((p, i) => {
          const c = colorFor(p.type)
          return (
            <Rect
              key={`${p.label}-${i}-r`}
              x={p.x_mm}
              y={p.y_mm}
              width={p.width_mm}
              height={p.height_mm}
              stroke={c.stroke}
              strokeWidth={0.5}
              fill={c.fill}
            />
          )
        })}
        {/* Подписи — отдельный проход вторым слоем. Гарантирует z-order:
            labels всегда поверх всех rect'ов (а не только своего). На
            миниатюрах showLabels=false — подписи не рендерятся вовсе. */}
        {showLabels && spread.placeholders.map((p, i) => {
          const c = colorFor(p.type)
          return (
            <Label key={`${p.label}-${i}-l`} x={p.x_mm} y={p.y_mm}>
              <Tag fill={c.stroke} cornerRadius={cornerRadiusMm} />
              <Text
                text={p.label}
                fill="white"
                fontSize={labelFontMm}
                padding={labelPaddingMm}
              />
            </Label>
          )
        })}
      </Layer>
    </Stage>
  )
}
