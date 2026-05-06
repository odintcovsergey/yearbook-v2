'use client'

import { Stage, Layer, Rect } from 'react-konva'
import type { SpreadTemplate } from './types'

type Props = {
  spread: SpreadTemplate
  containerWidth: number
}

export default function SpreadCanvas({ spread, containerWidth }: Props) {
  const scale = containerWidth / spread.width_mm
  const stageWidth = spread.width_mm * scale
  const stageHeight = spread.height_mm * scale

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
        {/* Bbox каждого плейсхолдера — axis-aligned (rotation_deg игнорируется
            в 0.8.2, см. project_phase0_parser_followups.md) */}
        {spread.placeholders.map((p, i) => (
          <Rect
            key={`${p.label}-${i}`}
            x={p.x_mm}
            y={p.y_mm}
            width={p.width_mm}
            height={p.height_mm}
            stroke="#374151"
            strokeWidth={0.5}
            fill="transparent"
          />
        ))}
      </Layer>
    </Stage>
  )
}
