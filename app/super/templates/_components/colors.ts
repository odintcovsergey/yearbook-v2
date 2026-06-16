export const PLACEHOLDER_COLORS = {
  photo: { stroke: '#1e40af', fill: '#dbeafe40' },
  text:  { stroke: '#15803d', fill: '#dcfce740' },
  // Привязанный/фоновый декор (мастера с декоративными рамками, напр. «Аква
  // меч»). Без этой записи превью-канвас падал на PLACEHOLDER_COLORS[type].
  decoration: { stroke: '#9333ea', fill: '#f3e8ff40' },
} as const

// Фолбэк для любого неизвестного типа плейсхолдера — чтобы превью НЕ роняло
// всю страницу (client-side exception), если в мастере встретится тип, не
// учтённый здесь.
export const PLACEHOLDER_COLOR_FALLBACK = { stroke: '#6b7280', fill: '#f3f4f640' }
