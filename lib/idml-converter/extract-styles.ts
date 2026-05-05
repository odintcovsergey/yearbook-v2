/**
 * Извлечение стилей текста из Stories/*.xml и Resources/Styles.xml.
 *
 * В коммите 0.2.1 — заглушка с дефолтами.
 * Полная реализация — коммит 0.3 (см. docs/phase-0-spec.md §11).
 */

import type { TextPlaceholder } from './types';

/**
 * Дефолты текстового стиля. Используются пока 0.3 не реализован,
 * а также как fallback если в Stories/Styles нужные поля отсутствуют
 * (см. docs/templates/idml-recon-notes.md §6.7).
 */
export const TEXT_STYLE_DEFAULTS: Pick<
  TextPlaceholder,
  | 'font_family'
  | 'font_size_pt'
  | 'font_weight'
  | 'color'
  | 'align'
  | 'vertical_align'
  | 'auto_fit'
> = {
  font_family: 'Geologica',
  font_size_pt: 14,
  font_weight: 'regular',
  color: '#1a1a1a',
  align: 'left',
  vertical_align: 'top',
  auto_fit: false,
};

/**
 * В 0.2.1 возвращает дефолты вне зависимости от ссылки на Story.
 * В 0.3 будет читать Stories/<storyId>.xml + Resources/Styles.xml.
 */
export function resolveTextStyle(
  _storyRef: string | null,
): typeof TEXT_STYLE_DEFAULTS {
  return TEXT_STYLE_DEFAULTS;
}
