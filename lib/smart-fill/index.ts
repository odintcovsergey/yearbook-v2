/**
 * Публичный API smart-fill.
 *
 * В фазе 1 модуль состоит из одного helper'а — buildAlbumInput.
 * В фазах 2+ может расшириться (canvas-prep, batch smart-fill и т.д.).
 */

export { buildAlbumInput } from './build-album-input';
export { filterChildrenByPurchase } from './filter-by-purchase';
export type {
  SmartFillWarningCode,
  SmartFillWarning,
  BuildAlbumInputResult,
} from './build-album-input';
