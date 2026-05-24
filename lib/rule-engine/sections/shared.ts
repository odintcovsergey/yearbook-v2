/**
 * Общий контекст для функций-секций (sections/*.ts).
 *
 * Каждая функция-секция получает ссылку на `SectionFillContext` и
 * мутирует его поля `pageInstances` / `warnings` / `decisionTrace` /
 * `available`. Это типичная архитектура для билдеров: контекст-объект
 * передаётся по ссылке, мутации накапливаются.
 *
 * Контекст создаётся в orchestrator-е (build-from-section-structure.ts)
 * один раз на запуск buildFromSectionStructure.
 */

import type { RuleEngineBundle } from '../loaders';
import type {
  DecisionTraceEntry,
  PageInstance,
  RulesAlbumInput,
} from '../types';
import type { CommonPhotoCounts } from '../slot-chains';

export interface SectionFillContext {
  /** Загруженные данные пресета + правила + мастера. */
  bundle: RuleEngineBundle;

  /** Вход — данные альбома (students, subjects, head_teacher, common_photos). */
  input: RulesAlbumInput;

  /**
   * Остаток общих фото после уже потреблённых секциями.
   * Каждая секция, расходующая общие фото (common, teachers, students-combined),
   * декрементит эти счётчики.
   */
  available: CommonPhotoCounts;

  /** Накопитель страниц. Позиция (left/right) определяется чётностью index. */
  pageInstances: PageInstance[];

  /** Накопитель decision_trace для отладки. */
  decisionTrace: DecisionTraceEntry[];

  /** Накопитель warnings (slot_skipped, master_not_found, не-implemented секции). */
  warnings: string[];

  /** Индекс текущей секции в preset.section_structure (для decision_trace.section_index). */
  sectionIndex: number;
}

/**
 * РЭ.37.3.b.2 (25.05.2026): человекочитаемое имя категории фото для warning'ов,
 * адресованных партнёру (не разработчику). Используется в формулировках
 * вроде "не хватило фото типа …", чтобы было понятно куда докинуть фото
 * в UI Окейбуки.
 *
 * Категории соответствуют ярлыкам в UI загрузки: common_full, common_half,
 * common_sixth, common_quarter, common_spread.
 */
export function humanPhotoCategory(category: string): string {
  switch (category) {
    case 'full_class':
      return 'общие фото класса (на всю страницу)';
    case 'half_class':
      return 'общие половинные фото (две на разворот)';
    case 'sixth':
      return 'общие фото для коллажа (шесть на страницу)';
    case 'quarter':
      return 'общие четвертные фото (четыре на страницу)';
    case 'spread':
      return 'общие фото на разворот';
    default:
      return category;
  }
}

/**
 * РЭ.37.5.b (25.05.2026): автоцентрирование видимых слотов в последнем
 * ряду grid/combo-страницы.
 *
 * Когда страница имеет N слотов в ряд (например studentportrait_1..6),
 * и последние K скрыты через __hidden__<label>, оставшиеся N-K слотов
 * по умолчанию остаются на своих исходных координатах — то есть «прижаты
 * к левому краю», а правая часть ряда выглядит пусто. Это визуальная
 * проблема симметризованного хвоста (РЭ.37.4) и адаптивного хвоста сетки
 * (когда учеников меньше чем слотов).
 *
 * Эта функция вычисляет геометрический shift и записывает в `bindings`
 * ключи __pos__<label>='<x_mm>,<y_mm>' для каждого видимого portrait
 * (и связанного с ним studentname/studentquote) — так renderer
 * (Canvas/PDF, через parseBalanceOverrides) разместит слоты по центру
 * фактической ширины ряда.
 *
 * Алгоритм:
 *   1. Найти studentportrait_* placeholder'ы мастера.
 *   2. Сгруппировать в строки по y_mm (с допуском 5 мм).
 *   3. Для каждой строки где есть hidden — посчитать shift и применить.
 *      Условия применения:
 *        - в строке ≥2 слота (есть шаг dx между соседними)
 *        - hidden идут «с конца» (защита от mixed-pattern)
 *
 * Связь portrait ↔ name ↔ quote: по числовому индексу в label. Если в
 * мастере есть studentportrait_5 + studentname_5 + studentquote_5 — все
 * три получают одинаковый shift и записываются под __pos__.
 *
 * Эффект на полные страницы grid (когда hidden нет): no-op — ни одной
 * __pos__ записи не добавляется, центрирование не нужно.
 */
export function centerLastRowSlots(
  master: { placeholders?: ReadonlyArray<{ label: string; x_mm: number; y_mm: number }> },
  bindings: Record<string, unknown>,
): void {
  const placeholders = master.placeholders ?? [];
  if (placeholders.length === 0) return;

  type Slot = { label: string; n: number; x_mm: number; y_mm: number };
  const portraits: Slot[] = [];
  for (const ph of placeholders) {
    const m = ph.label.toLowerCase().match(/^studentportrait_(\d+)$/);
    if (!m) continue;
    portraits.push({
      label: ph.label,
      n: parseInt(m[1], 10),
      x_mm: ph.x_mm,
      y_mm: ph.y_mm,
    });
  }
  if (portraits.length < 2) return;

  // Группируем в строки по y (tolerance 5 мм).
  const Y_TOL = 5;
  const rows: Slot[][] = [];
  for (const slot of [...portraits].sort((a, b) => a.y_mm - b.y_mm || a.x_mm - b.x_mm)) {
    const row = rows.find((r) => Math.abs(r[0].y_mm - slot.y_mm) < Y_TOL);
    if (row) row.push(slot);
    else rows.push([slot]);
  }
  for (const row of rows) row.sort((a, b) => a.x_mm - b.x_mm);

  function relatedLabels(n: number): string[] {
    const out: string[] = [];
    for (const ph of placeholders) {
      const lower = ph.label.toLowerCase();
      if (lower === `studentname_${n}` || lower === `studentquote_${n}`) {
        out.push(ph.label);
      }
    }
    return out;
  }

  for (const row of rows) {
    if (row.length < 2) continue;
    const hidden = row.filter((s) => bindings[`__hidden__${s.label}`] != null);
    const filled = row.filter((s) => bindings[`__hidden__${s.label}`] == null);
    if (hidden.length === 0 || filled.length === 0) continue;

    // Защита: hidden идут «с конца» (paтерн bindGridStudents).
    const maxFilledN = Math.max(...filled.map((s) => s.n));
    const minHiddenN = Math.min(...hidden.map((s) => s.n));
    if (minHiddenN <= maxFilledN) continue;

    // Шаг dx — среднее расстояние между соседними слотами в строке.
    let dxSum = 0;
    let dxCount = 0;
    for (let i = 1; i < row.length; i++) {
      const d = row[i].x_mm - row[i - 1].x_mm;
      if (d > 0) {
        dxSum += d;
        dxCount++;
      }
    }
    if (dxCount === 0) continue;
    const dx = dxSum / dxCount;

    // Сдвиг: половина суммарной ширины скрытых слотов.
    const shift = (hidden.length * dx) / 2;
    if (shift <= 0) continue;

    for (const slot of filled) {
      const newX = slot.x_mm + shift;
      bindings[`__pos__${slot.label}`] = `${newX},${slot.y_mm}`;
      for (const relLabel of relatedLabels(slot.n)) {
        const relPh = placeholders.find((p) => p.label === relLabel);
        if (!relPh) continue;
        const newRelX = relPh.x_mm + shift;
        bindings[`__pos__${relLabel}`] = `${newRelX},${relPh.y_mm}`;
      }
    }
  }
}
