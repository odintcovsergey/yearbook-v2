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

export {
  countAlbumSheets,
  computeAlbumSpineWidthMm,
  resolveAlbumSpineWidthMm,
} from './album-spine';

export {
  resolveCoverForStudent,
  fillCoverData,
  assembleCovers,
} from './assemble';

export type {
  CoverStudentInput,
  CoverChoiceInput,
  CoverAssemblyConfig,
  CoverSharedContent,
  CoverInstance,
} from './assemble';

export { loadAlbumCovers } from './load-covers';
export type { AssembledCoversResult } from './load-covers';

export { layoutCover } from './layout';
export type {
  CoverZoneName,
  CoverLayoutInput,
  CoverLayoutResult,
} from './layout';

export { renderCoverPreviewSvg } from './preview-svg';
export type { CoverPreviewInput } from './preview-svg';
