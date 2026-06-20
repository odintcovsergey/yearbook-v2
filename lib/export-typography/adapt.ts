/**
 * Адаптация всего набора (TemplateSet) под формат заказа для типографской
 * выгрузки (ТЗ экспорта 20.06.2026).
 *
 * Готовая модель lib/format-adapt адаптирует ОДИН мастер. Здесь — обёртка над
 * набором: каждый мастер приводится к формату, а размеры страницы/вылеты набора
 * подменяются на формат заказа, чтобы дальше pdf-export считал pageBoxes от
 * формата БЕЗ изменений в самом рендере.
 *
 * Несовместимое семейство (квадрат↔прямоугольник) → набор НЕ адаптируется
 * (отдаём как есть + warning), иначе размеры разъедутся с контентом мастеров.
 */

import type { TemplateSet } from '../album-builder/types';
import type { PrinterFormat } from '../printers/types';
import {
  adaptTemplateToFormat,
  resolveDesignFamily,
  FAMILY_LABELS,
  type AdaptSource,
} from '../format-adapt';

export interface AdaptSetResult {
  templateSet: TemplateSet;
  status: 'native' | 'adapted' | 'incompatible';
  /** Предупреждение при несовместимом семействе (иначе undefined). */
  warning?: string;
}

/**
 * Адаптирует набор под формат заказа.
 *  - target=null → 'native' (набор как есть, родной формат дизайна);
 *  - семейство дизайна ≠ семейство формата → 'incompatible' (как есть + warning);
 *  - иначе → 'adapted': все мастера uniform-масштабом под формат, размеры
 *    страницы/вылеты набора = формат заказа.
 */
export function adaptTemplateSetToFormat(
  set: TemplateSet,
  target: PrinterFormat | null,
): AdaptSetResult {
  if (!target) return { templateSet: set, status: 'native' };

  const family = resolveDesignFamily(set);
  if (family !== target.family) {
    return {
      templateSet: set,
      status: 'incompatible',
      warning:
        `Дизайн (${FAMILY_LABELS[family]}) не подходит под формат ` +
        `${target.name} (${FAMILY_LABELS[target.family]}) — нужен отдельный ` +
        `дизайн этого семейства. Экспортирован родной формат дизайна.`,
    };
  }

  const source: AdaptSource = {
    pageWidthMm: set.page_width_mm,
    pageHeightMm: set.page_height_mm,
    family,
  };

  const spreads = set.spreads.map(
    (t) => adaptTemplateToFormat(t, source, target).template,
  );

  return {
    status: 'adapted',
    templateSet: {
      ...set,
      page_width_mm: target.page_w_mm,
      page_height_mm: target.page_h_mm,
      bleed_mm: target.bleed_mm,
      spreads,
    },
  };
}
