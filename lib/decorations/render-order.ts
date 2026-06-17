/**
 * Z-порядок отрисовки привязанного декора (Часть 1 ТЗ docs/tz-attached-decor.md).
 *
 * Единый источник правды о порядке слоёв — используется и канвасом
 * (AlbumSpreadCanvas, Konva рисует в порядке массива), и PDF-экспортом
 * (Этап 5, pdf-lib рисует в порядке вызовов). Так превью = финальный PDF.
 *
 * Порядок слоёв (z снизу вверх):
 *   [фон разворота] → [ВСЕ __under-декор] → [фото/текст-слоты] → [ВСЕ __over-декор]
 *   → [foreground-декор разворота (Часть 4, метка __fg_<n>)]
 *
 * `__under`-декор — это пласт ПОЗАДИ всех слотов (под всеми фото и текстами),
 * `__over` — пласт ПОВЕРХ всех слотов (но под foreground). Это «слоевая»
 * модель, а не попарная.
 *
 * Почему слоевая, а не попарная (фикс бага «Аква меч», 17.06.2026):
 * раньше декор вставлялся вплотную к своей базе ([под] [база] [над]). Но
 * подложка-облако `studentquote_1__under` тогда рисовалась ПОСЛЕ портрета
 * (портрет — отдельный слот, идущий раньше в списке) и перекрывала его.
 * В InDesign дизайнер кладёт такую подложку в самый низ — слоевая модель это
 * повторяет: __under всегда позади всех фото/портретов, __over — поверх них.
 * Внутри одного слота поведение прежнее (под→база→над), садиковские сетки не
 * меняются (декор слота не пересекает соседние слоты).
 * `foreground`-декор не привязан к слоту и рисуется В САМОМ КОНЦЕ — поверх
 * всего разворота (сказочный дизайн: ветки поверх рамок).
 */

/** Минимальная форма для сортировки — реальные плейсхолдеры шире. */
type OrderablePlaceholder = {
  label: string;
  type: string;
  attached_to?: string;
  layer?: 'under' | 'over' | 'foreground';
};

function isAttachedDecoration(
  ph: OrderablePlaceholder,
): ph is OrderablePlaceholder & { attached_to: string; layer: 'under' | 'over' } {
  return (
    ph.type === 'decoration' &&
    typeof ph.attached_to === 'string' &&
    ph.attached_to !== '' &&
    (ph.layer === 'under' || ph.layer === 'over')
  );
}

function isForeground(ph: OrderablePlaceholder): boolean {
  return ph.type === 'decoration' && ph.layer === 'foreground';
}

/**
 * Возвращает плейсхолдеры в порядке отрисовки (z снизу вверх): слоевая модель
 * [все __under] → [фото/текст-слоты] → [все __over] → [foreground].
 *
 * Каждый слой сохраняет исходный относительный порядок входа (стабильно).
 * Orphan-декор (база отфильтрована как hidden / опечатка в метке) не теряется —
 * он просто остаётся в своём слое наравне с остальным декором. Не мутирует вход.
 */
export function orderPlaceholdersForRender<T extends OrderablePlaceholder>(
  placeholders: readonly T[],
): T[] {
  const unders: T[] = [];
  const overs: T[] = [];
  const foregrounds: T[] = [];
  const bases: T[] = [];

  for (const ph of placeholders) {
    if (isForeground(ph)) {
      foregrounds.push(ph);
    } else if (isAttachedDecoration(ph)) {
      (ph.layer === 'under' ? unders : overs).push(ph);
    } else {
      bases.push(ph);
    }
  }

  // Слои снизу вверх: подложки → слоты → накладки → передний план.
  return [...unders, ...bases, ...overs, ...foregrounds];
}
