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
/**
 * РЭ.42.b.2: универсальный placeholder-driven биндинг для override-мастеров
 * в soft_intro / soft_final. Партнёр в редакторе шаблона выбирает любой
 * мастер из template_set (типично — учителей / классного руководителя /
 * воспитателей детсада). Эта функция связывает placeholder'ы выбранного
 * мастера с реальными данными из RulesAlbumInput.
 *
 * Поддерживаемые placeholder labels (case-insensitive):
 *  - `classphotoframe`                                  → full_class[cursor]
 *  - `halfphoto_N`                                      → half_class[cursor + N - 1]
 *  - `headteacherphoto`                                 → head_teacher.photo
 *  - `headteachername`                                  → head_teacher.name
 *  - `headteacherrole`                                  → head_teacher.role
 *  - `headteachertext` / `headteacherquote` /
 *    `headtextframe`                                    → head_teacher.text
 *  - `subjectphoto_N` / `subject_N` / `teacherphoto_N`  → subjects[N-1].photo
 *  - `subjectname_N` / `teachername_N`                  → subjects[N-1].name
 *  - `subjectrole_N` / `teacherrole_N`                  → subjects[N-1].role
 *
 * Для отсутствующих фото / subjects ставится `__hidden__<label>='1'` —
 * Konva canvas скроет пустые слоты (РЭ.21.8.13 семантика).
 *
 * Cursor для full_class / half_class — по уже-потреблённым (как в teachers.ts
 * bindRightPage): `arr.length - available[k]`. Каждое потреблённое фото
 * учитывается в возвращаемом `consumes`, чтобы вызывающая секция
 * декрементила `available`.
 *
 * Эта функция — расширенная версия классической classphoto-only биндинг
 * логики из soft-intro.ts / soft-final.ts. В автоматическом (без override)
 * режиме старая classphoto-only логика сохранена (минимизация риска
 * регрессий в стабильных code paths). В override-режиме вызывается эта
 * функция, что позволяет партнёру использовать учительские мастера.
 *
 * Семантика consumes:
 *  - full_class: 0..1 — у мастера обычно ≤1 classphotoframe placeholder
 *  - half_class: 0..N — может быть несколько halfphoto_N в одном мастере
 *
 * subjects / head_teacher — не cursored: индексы фиксированные (subject N
 * это всегда subjects[N-1]), потребление не отслеживается (это
 * непотребляемые данные, привязанные к альбому).
 */
/**
 * РЭ.42.b.2: универсальный placeholder-driven биндинг для override-мастеров
 * в soft_intro / soft_final. Партнёр в редакторе шаблона выбирает любой
 * мастер из template_set (типично — учителей / классного руководителя /
 * воспитателей детсада). Эта функция связывает placeholder'ы выбранного
 * мастера с реальными данными из RulesAlbumInput.
 *
 * Поддерживаемые placeholder labels (case-insensitive):
 *  - `classphotoframe`                                  → full_class[cursor]
 *  - `halfphoto_N`                                      → half_class[cursor + N - 1]
 *  - `quarterphoto_N`                                   → quarter[cursor + N - 1]      (РЭ.42.b.3)
 *  - `collagephoto_N`                                   → sixth[cursor + N - 1]        (РЭ.42.b.3)
 *  - `spreadphoto` / `spreadphoto_N`                    → spread[cursor + N - 1]       (РЭ.42.b.3)
 *  - `headteacherphoto`                                 → head_teacher.photo
 *  - `headteachername`                                  → head_teacher.name
 *  - `headteacherrole`                                  → head_teacher.role
 *  - `headteachertext` / `headteacherquote` /
 *    `headtextframe`                                    → head_teacher.text
 *  - `subjectphoto_N` / `subject_N` / `teacherphoto_N`  → subjects[N-1].photo
 *  - `subjectname_N` / `teachername_N`                  → subjects[N-1].name
 *  - `subjectrole_N` / `teacherrole_N`                  → subjects[N-1].role
 *
 * Для отсутствующих фото / subjects ставится `__hidden__<label>='1'` —
 * Konva canvas скроет пустые слоты (РЭ.21.8.13 семантика).
 *
 * Cursor для full_class / half_class / quarter / sixth — по уже-потреблённым
 * (как в teachers.ts bindRightPage): `arr.length - available[k]`. Каждое
 * потреблённое фото учитывается в возвращаемом `consumes`, чтобы
 * вызывающая секция декрементила `available`.
 *
 * spread — это отдельная категория common_photos.spread, в CommonPhotoCounts
 * не отслеживается (по архитектурным причинам — full-spread мастера редки).
 * Биндинг spread*: cursor = 0, потребление не вычисляем (никто после
 * нас не использует spread в override-режиме).
 *
 * Эта функция — расширенная версия классической classphoto-only биндинг
 * логики из soft-intro.ts / soft-final.ts. В автоматическом (без override)
 * режиме старая classphoto-only логика сохранена (минимизация риска
 * регрессий в стабильных code paths). В override-режиме вызывается эта
 * функция, что позволяет партнёру использовать учительские мастера И
 * мастера общего раздела (J-Collage-6, J-Quarter, J-Half, J-Spread)
 * как finale/intro page.
 *
 * Семантика consumes:
 *  - full_class: 0..1 — у мастера обычно ≤1 classphotoframe placeholder
 *  - half_class: 0..N — может быть несколько halfphoto_N в одном мастере
 *  - quarter:    0..4 — quarter-мастера обычно содержат 4 placeholder'а
 *  - sixth:      0..N — collage-мастера 6 или меньше (РЭ.42.b.3)
 *
 * subjects / head_teacher — не cursored: индексы фиксированные (subject N
 * это всегда subjects[N-1]), потребление не отслеживается (это
 * непотребляемые данные, привязанные к альбому).
 */
export function bindOverrideMasterPlaceholders(
  master: { placeholders?: ReadonlyArray<{ label: string }> },
  input: RulesAlbumInput,
  available: CommonPhotoCounts,
): {
  bindings: Record<string, unknown>;
  consumes: {
    full_class: number;
    half_class: number;
    quarter: number;
    sixth: number;
  };
} {
  const bindings: Record<string, unknown> = {};
  const placeholders = master.placeholders ?? [];

  const fullClassUsed = input.common_photos.full_class.length - available.full_class;
  const halfClassUsed = input.common_photos.half_class.length - available.half_class;
  const quarterUsed = input.common_photos.quarter.length - available.quarter;
  const sixthUsed = input.common_photos.sixth.length - available.sixth;
  let consumedFullClass = 0;
  let consumedHalfClass = 0;
  let consumedQuarter = 0;
  let consumedSixth = 0;

  const headTeacher = input.head_teacher;
  const subjects = input.subjects;

  for (let i = 0; i < placeholders.length; i++) {
    const ph = placeholders[i];
    const label = ph.label.toLowerCase();

    // ─ Общее фото класса ────────────────────────────────────────────
    if (label === 'classphotoframe') {
      const photo = input.common_photos.full_class[fullClassUsed + consumedFullClass];
      if (photo) {
        bindings[ph.label] = photo;
        consumedFullClass += 1;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }

    // ─ Полкласса (halfphoto_N) ───────────────────────────────────────
    const halfMatch = label.match(/^halfphoto_(\d+)$/);
    if (halfMatch) {
      const n = parseInt(halfMatch[1], 10);
      // halfphoto_1, halfphoto_2 — индексы внутри мастера, должны идти
      // подряд от cursor'а: photo для halfphoto_N = half_class[cursor + N - 1].
      // Каждый встреченный halfphoto увеличивает consumed на 1 (т.е. позже
      // мы декрементируем available.half_class на это число).
      const photo = input.common_photos.half_class[halfClassUsed + n - 1];
      if (photo) {
        bindings[ph.label] = photo;
        consumedHalfClass = Math.max(consumedHalfClass, n);
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }

    // ─ Quarter (quarterphoto_N) ─ РЭ.42.b.3 ──────────────────────────
    const quarterMatch = label.match(/^quarterphoto_(\d+)$/);
    if (quarterMatch) {
      const n = parseInt(quarterMatch[1], 10);
      const photo = input.common_photos.quarter[quarterUsed + n - 1];
      if (photo) {
        bindings[ph.label] = photo;
        consumedQuarter = Math.max(consumedQuarter, n);
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }

    // ─ Collage / sixth (collagephoto_N) ─ РЭ.42.b.3 ──────────────────
    const collageMatch = label.match(/^collagephoto_(\d+)$/);
    if (collageMatch) {
      const n = parseInt(collageMatch[1], 10);
      const photo = input.common_photos.sixth[sixthUsed + n - 1];
      if (photo) {
        bindings[ph.label] = photo;
        consumedSixth = Math.max(consumedSixth, n);
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }

    // ─ Spread (spreadphoto / spreadphoto_N) ─ РЭ.42.b.3 ──────────────
    // spread не отслеживается через CommonPhotoCounts (отдельная редкая
    // категория). Cursor=0, потребление не возвращаем.
    if (label === 'spreadphoto') {
      const photo = input.common_photos.spread[0];
      if (photo) {
        bindings[ph.label] = photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const spreadMatch = label.match(/^spreadphoto_(\d+)$/);
    if (spreadMatch) {
      const n = parseInt(spreadMatch[1], 10);
      const photo = input.common_photos.spread[n - 1];
      if (photo) {
        bindings[ph.label] = photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }

    // ─ Главный учитель / классный руководитель ──────────────────────
    if (label === 'headteacherphoto') {
      if (headTeacher.photo) {
        bindings[ph.label] = headTeacher.photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    if (label === 'headteachername') {
      bindings[ph.label] = headTeacher.name;
      continue;
    }
    if (label === 'headteacherrole') {
      bindings[ph.label] = headTeacher.role;
      continue;
    }
    if (
      label === 'headteachertext' ||
      label === 'headteacherquote' ||
      label === 'headtextframe'
    ) {
      bindings[ph.label] = headTeacher.text;
      continue;
    }

    // ─ Предметники / учителя по номерам ────────────────────────────
    const photoMatch = label.match(/^(?:subjectphoto|subject|teacherphoto)_(\d+)$/);
    if (photoMatch) {
      const n = parseInt(photoMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj && subj.photo) {
        bindings[ph.label] = subj.photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const nameMatch = label.match(/^(?:subjectname|teachername)_(\d+)$/);
    if (nameMatch) {
      const n = parseInt(nameMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj) {
        bindings[ph.label] = subj.name;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const roleMatch = label.match(/^(?:subjectrole|teacherrole)_(\d+)$/);
    if (roleMatch) {
      const n = parseInt(roleMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj) {
        bindings[ph.label] = subj.role;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }

    // Любой неизвестный placeholder — оставляем без binding (Konva canvas
    // покажет default-плейсхолдер из IDML, партнёр заполнит в редакторе).
  }

  return {
    bindings,
    consumes: {
      full_class: consumedFullClass,
      half_class: consumedHalfClass,
      quarter: consumedQuarter,
      sixth: consumedSixth,
    },
  };
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
