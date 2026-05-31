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
 * Привязанный декор (Часть 1 ТЗ docs/tz-attached-decor.md). Локальная
 * рантайм-форма — balance-overrides не зависит от idml-converter; поля
 * совпадают с DecorationPlaceholder (attached_to / offset_x_mm / offset_y_mm).
 */
type DecorationLike = {
  type: 'decoration';
  attached_to: string;
  offset_x_mm: number;
  offset_y_mm: number;
};

/**
 * Рантайм-распознавание ПРИВЯЗАННОГО декора (Часть 1). Foreground-декор
 * (Часть 4, attached_to='') сюда не попадает — он не привязан к слоту, не
 * скрывается и не двигается, проходит обычным путём как самостоятельный слот.
 */
function asDecoration(ph: Placeholder): DecorationLike | null {
  const p = ph as unknown as Record<string, unknown>;
  if (
    p.type === 'decoration' &&
    typeof p.attached_to === 'string' &&
    p.attached_to !== '' &&
    typeof p.offset_x_mm === 'number' &&
    typeof p.offset_y_mm === 'number'
  ) {
    return p as unknown as DecorationLike;
  }
  return null;
}

/**
 * Применяет override'ы к списку placeholder'ов:
 *   - hidden=true → placeholder исключается из вывода
 *   - x_mm/y_mm → placeholder получает новые координаты
 *
 * Привязанный декор (type:'decoration', Часть 1 ТЗ) СЛЕДУЕТ за своим базовым
 * слотом (`attached_to`), а НЕ за собственным label:
 *   - база скрыта (__hidden__<base>)  → декор тоже исключается;
 *   - база перемещена (__pos__<base>) → декор = новая позиция базы + offset;
 *   - база на месте                   → декор на исходной позиции.
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
  const out: Placeholder[] = [];
  for (const p of placeholders) {
    // Декор привязан к базовому слоту — смотрим override базы, не свой label.
    const decor = asDecoration(p);
    if (decor) {
      const baseOv = overrides[decor.attached_to];
      if (baseOv?.hidden) continue; // база скрыта → декор скрыт
      if (baseOv && baseOv.x_mm !== undefined && baseOv.y_mm !== undefined) {
        // база сдвинута → декор = новая позиция базы + сохранённый offset
        out.push({
          ...p,
          x_mm: baseOv.x_mm + decor.offset_x_mm,
          y_mm: baseOv.y_mm + decor.offset_y_mm,
        });
      } else {
        out.push(p); // база на месте → декор на исходной позиции
      }
      continue;
    }

    if (overrides[p.label]?.hidden) continue;
    const ov = overrides[p.label];
    if (!ov || (ov.x_mm === undefined && ov.y_mm === undefined)) {
      out.push(p);
      continue;
    }
    out.push({
      ...p,
      x_mm: ov.x_mm ?? p.x_mm,
      y_mm: ov.y_mm ?? p.y_mm,
    });
  }
  return out;
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
