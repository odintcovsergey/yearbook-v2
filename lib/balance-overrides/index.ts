/**
 * lib/balance-overrides — единый источник правды для применения
 * балансировки rule engine к списку placeholder'ов (БТ.1.4).
 *
 * Используется в:
 *   - app/app/_components/AlbumSpreadCanvas.tsx (Konva preview + editor)
 *   - lib/pdf-export/pipeline.ts (sharp + pdf-lib для финального PDF)
 *
 * Хранение балансировки в album_layouts.spreads[].data — служебные ключи:
 *   __hidden__<label>  — '1' / 'true' значение → placeholder скрыт
 *                        (после lib/rule-engine/balance.ts hide_unfilled)
 *   __pos__<label>     — '<x_mm>,<y_mm>' → placeholder переразмещён
 *                        (после balance.ts placeholder_centering)
 *
 * Эти ключи пишутся в bindings rule engine, копируются в data адаптером
 * layout-to-buildresult, и должны единообразно применяться везде где
 * происходит рендер (Canvas / PDF) — это гарантирует что превью =
 * финальный PDF.
 *
 * Семантика match с lib/rule-engine/balance.ts §10.1:
 *   - width/height НЕ меняются балансировкой (только x_mm/y_mm + hidden)
 *   - hidden имеет приоритет над pos (скрытый плейсхолдер не нужно
 *     перемещать)
 */

import type { Placeholder } from '@/lib/album-builder/types';

/**
 * Структура override для одного placeholder'а. Внутреннее представление
 * после парсинга data ключей.
 */
type Override = {
  hidden?: boolean;
  x_mm?: number;
  y_mm?: number;
};

/**
 * Парсит __hidden__/__pos__ ключи из data в map override'ов по label.
 * Возвращает null если в data нет ни одного релевантного ключа —
 * это позволяет caller'у сделать early return без работы.
 */
export function parseBalanceOverrides(
  data: Record<string, string | null>,
): Record<string, Override> | null {
  const overrides: Record<string, Override> = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string') continue;
    if (k.startsWith('__hidden__')) {
      const label = k.slice('__hidden__'.length);
      // Любое непустое значение кроме '0'/'false' трактуется как true.
      // Это match с balance.ts который пишет '1'.
      if (v && v !== '0' && v !== 'false') {
        if (!overrides[label]) overrides[label] = {};
        overrides[label].hidden = true;
        hasAny = true;
      }
    } else if (k.startsWith('__pos__')) {
      const label = k.slice('__pos__'.length);
      // Формат '<x_mm>,<y_mm>' (decimal mm).
      const parts = v.split(',').map((s) => Number(s.trim()));
      if (parts.length === 2 && parts.every(Number.isFinite)) {
        if (!overrides[label]) overrides[label] = {};
        overrides[label].x_mm = parts[0];
        overrides[label].y_mm = parts[1];
        hasAny = true;
      }
    }
  }
  return hasAny ? overrides : null;
}

/**
 * Применяет override'ы к списку placeholder'ов:
 *   - hidden=true → placeholder исключается из вывода
 *   - x_mm/y_mm → placeholder получает новые координаты
 *
 * Если overrides=null (нет ключей в data) — возвращает placeholders
 * как есть (identity). Если override.hidden=false и нет x_mm/y_mm —
 * placeholder тоже возвращается как есть (no-op).
 *
 * Не мутирует входные данные — возвращает новый массив с поверхностными
 * клонами изменённых placeholder'ов.
 */
export function applyBalanceOverrides(
  placeholders: Placeholder[],
  overrides: Record<string, Override> | null,
): Placeholder[] {
  if (!overrides) return placeholders;
  return placeholders
    .filter((p) => !overrides[p.label]?.hidden)
    .map((p) => {
      const ov = overrides[p.label];
      if (!ov || (ov.x_mm === undefined && ov.y_mm === undefined)) return p;
      return {
        ...p,
        x_mm: ov.x_mm ?? p.x_mm,
        y_mm: ov.y_mm ?? p.y_mm,
      };
    });
}

/**
 * Удобный shortcut — parseBalanceOverrides + applyBalanceOverrides
 * в одну операцию. Идеально для Canvas/PDF call-site когда не нужно
 * сохранять промежуточный overrides объект.
 */
export function applyBalanceFromData(
  placeholders: Placeholder[],
  data: Record<string, string | null>,
): Placeholder[] {
  return applyBalanceOverrides(placeholders, parseBalanceOverrides(data));
}
