'use client'

import { Stage, Layer, Rect, Label, Tag, Text } from 'react-konva'
import type { SpreadTemplate } from './types'
import { PLACEHOLDER_COLORS } from './colors'

type Props = {
  spread: SpreadTemplate
  containerWidth: number
}

export default function SpreadCanvas({ spread, containerWidth }: Props) {
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
        {/* Bbox + label-плашка на каждый плейсхолдер. Axis-aligned
            (rotation_deg игнорируется в 0.8.x — см.
            project_phase0_parser_followups.md). */}
        {spread.placeholders.flatMap((p, i) => {
          const c = PLACEHOLDER_COLORS[p.type]
          return [
            <Rect
              key={`${p.label}-${i}-r`}
              x={p.x_mm}
              y={p.y_mm}
              width={p.width_mm}
              height={p.height_mm}
              stroke={c.stroke}
              strokeWidth={0.5}
              fill={c.fill}
            />,
            <Label key={`${p.label}-${i}-l`} x={p.x_mm} y={p.y_mm}>
              <Tag fill={c.stroke} cornerRadius={cornerRadiusMm} />
              <Text
                text={p.label}
                fill="white"
                fontSize={labelFontMm}
                padding={labelPaddingMm}
              />
            </Label>,
          ]
        })}
      </Layer>
    </Stage>
  )
}
