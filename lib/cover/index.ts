/**
 * Публичный API модуля обложки альбома (Этап 1, ТЗ docs/tz-cover-design.md).
 */
export type {
  CoverType,
  CoverLayoutMode,
  CoverGenderHint,
  CoverPlaceholderName,
  Cover,
  SheetType,
  PrintSpec,
  CoverChoice,
} from './types';

export {
  computeSpineWidthMm,
  resolveSheetType,
  computeSpineWidthFromPreset,
  computeCoverCanvasSize,
} from './spine';

export type {
  SpineInput,
  CoverCanvasInput,
  CoverCanvasSize,
} from './spine';
