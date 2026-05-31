/**
 * Z-порядок отрисовки привязанного декора (Часть 1 ТЗ docs/tz-attached-decor.md).
 *
 * Единый источник правды о порядке слоёв — используется и канвасом
 * (AlbumSpreadCanvas, Konva рисует в порядке массива), и PDF-экспортом
 * (Этап 5, pdf-lib рисует в порядке вызовов). Так превью = финальный PDF.
 *
 * Порядок на каждый базовый слот (ТЗ):
 *   [фон разворота] → [слот__under] → [фото/текст слота] → [слот__over]
 *
 * То есть `__under`-декор рисуется ПЕРЕД своим базовым слотом (ниже по z),
 * `__over` — ПОСЛЕ (выше по z). Базовые слоты между собой сохраняют исходный
 * порядок. Декор берётся СРАЗУ ПОСЛЕ/ПЕРЕД своей базой, а не общим пластом —
 * это позволяет декору одного слота лежать между соседними слотами корректно.
 */

/** Минимальная форма для сортировки — реальные плейсхолдеры шире. */
type OrderablePlaceholder = {
  label: string;
  type: string;
  attached_to?: string;
  layer?: 'under' | 'over';
};

function isDecoration(
  ph: OrderablePlaceholder,
): ph is OrderablePlaceholder & { attached_to: string; layer: 'under' | 'over' } {
  return (
    ph.type === 'decoration' &&
    typeof ph.attached_to === 'string' &&
    (ph.layer === 'under' || ph.layer === 'over')
  );
}

/**
 * Возвращает плейсхолдеры в порядке отрисовки (z снизу вверх).
 *
 * Для каждого базового слота (в исходном порядке) вставляет его `__under`-декор
 * перед ним и `__over`-декор после. Декор, чья база отсутствует в списке
 * (например, база была отфильтрована как hidden ДО сортировки, либо опечатка
 * в метке), дорисовывается в конце best-effort: under-декор не теряется молча,
 * но и не ломает порядок видимых слотов.
 *
 * Сохраняет относительный порядок декора одного слоя одной базы (стабильно).
 * Не мутирует вход.
 */
export function orderPlaceholdersForRender<T extends OrderablePlaceholder>(
  placeholders: readonly T[],
): T[] {
  const unders = new Map<string, T[]>();
  const overs = new Map<string, T[]>();
  const bases: T[] = [];
  const baseLabels = new Set<string>();

  for (const ph of placeholders) {
    if (isDecoration(ph)) {
      const bucket = ph.layer === 'under' ? unders : overs;
      const list = bucket.get(ph.attached_to);
      if (list) list.push(ph);
      else bucket.set(ph.attached_to, [ph]);
    } else {
      bases.push(ph);
      baseLabels.add(ph.label);
    }
  }

  const out: T[] = [];
  for (const base of bases) {
    const u = unders.get(base.label);
    if (u) out.push(...u);
    out.push(base);
    const o = overs.get(base.label);
    if (o) out.push(...o);
  }

  // Orphan-декор (базы нет в списке): дорисовываем в конце, under затем over.
  unders.forEach((list, attached) => {
    if (!baseLabels.has(attached)) out.push(...list);
  });
  overs.forEach((list, attached) => {
    if (!baseLabels.has(attached)) out.push(...list);
  });

  return out;
}
