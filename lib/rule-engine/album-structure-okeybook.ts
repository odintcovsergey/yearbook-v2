/**
 * Эталонная таблица OkeyBook автоверстки общего раздела.
 *
 * Источник: docs/okeybook/album-autoverstka-okeybook.xlsx (Сергей, 19.05.2026).
 * Бизнес-контекст: docs/okeybook/README.md.
 *
 * Это внутренний стандарт OkeyBook (не отраслевой) — описывает на пересечении
 *   (комплектация × тип листов × количество учеников)
 * как выглядит общий раздел альбома. Существует два общих раздела:
 *   - обязательный (required) — входит в стоимость, всегда строится;
 *   - дополнительный (additional, РЭ.21.8.10) — платная допуслуга OkeyBook
 *     для увеличения конверсии (родители докупают развороты).
 *
 * Этот файл содержит данные ОБЯЗАТЕЛЬНОГО раздела (колонки `обяз_1L..обяз_6R`
 * из xlsx). Дополнительный — отдельный файл/секция в РЭ.21.8.10.
 *
 * Логика «или-или» на странице
 * ─────────────────────────────
 * Запись страницы — массив попыток. Engine идёт по нему по порядку, останавливается
 * на первом мастере для которого хватает фото в пуле. Каждая попытка описана как
 * `{ master_name, category, count }` — какой мастер ставить и сколько фото
 * какой категории он потребляет.
 *
 * Пример: «либо 6 фото 1/6, либо 2 по 1/2 класса, либо 1 общая» =
 *   [
 *     { master: 'J-Collage-6', category: 'sixth',      count: 6 },
 *     { master: 'J-Half',      category: 'half_class', count: 2 },
 *     { master: 'J-Full',      category: 'full_class', count: 1 },
 *   ]
 *
 * Зеркальные мастера (J-Quarter-Left/-Right)
 * ──────────────────────────────────────────
 * Для категории `quarter` на правой стороне разворота используется мастер
 * `J-Quarter-Right` вместо `J-Quarter-Left`. Это учитывается в common-required.ts
 * через позицию страницы (left/right определяется по чётности).
 *
 * Структура записи таблицы
 * ────────────────────────
 * Каждая строка xlsx = одна запись TableRow с полями density / sheet_type /
 * students_match / pages. `students_match` — описание подходящих количеств
 * учеников в нескольких форматах (см. matchStudents).
 *
 * `pages` — массив 0-6 страниц. Длина может быть меньше 6 (например для Мини
 * мягкие «до 24» это 3 страницы). Пустой массив = обязательного раздела нет
 * (например Мини плотные 25+).
 */

import type { Density, PresetDensity, SheetType } from './types';

// ─── Типы записи таблицы ────────────────────────────────────────────────────

export type CommonCategory = 'full_class' | 'half_class' | 'quarter' | 'sixth';

/**
 * Один шаг попытки заполнения страницы. Если в пуле есть `count` фото
 * категории `category` — engine берёт мастер `master`. Иначе — следующий шаг.
 */
export interface PageAttempt {
  master: string;
  category: CommonCategory;
  count: number;
}

/**
 * Описание одной страницы общего раздела. Массив попыток в порядке приоритета.
 * Engine берёт первую где хватает фото; если ни одна не подошла — страница
 * пропускается с warning.
 */
export type PageDescriptor = PageAttempt[];

/**
 * Описание подходящих количеств учеников. Поддерживается несколько форматов
 * (см. matchStudents):
 *   - 'any' — подходит для любого количества (Максимум, переходная страница).
 *   - { ranges: [[1, 24]] } — один или несколько числовых интервалов.
 *   - { parity: 'even' } или { parity: 'odd' } — для Стандарт/Универсал.
 */
export type StudentsMatch =
  | { kind: 'any' }
  | { kind: 'ranges'; ranges: [number, number][] }
  | { kind: 'parity'; parity: 'even' | 'odd' };

export interface TableRow {
  density: Density;
  sheet_type: SheetType;
  students_match: StudentsMatch;
  /**
   * Страницы обязательного общего раздела в порядке появления.
   * Длина 0..6. Пустой массив = обязательного раздела нет.
   * Длина < 6 = меньше страниц чем максимум (например мягкие имеют меньше).
   */
  pages: PageDescriptor[];
  /**
   * РЭ.21.8.10: страницы ДОПОЛНИТЕЛЬНОГО общего раздела.
   *
   * Дополнительный раздел — платная допуслуга OkeyBook: партнёр продаёт
   * родителям возможность увеличить количество общих разворотов. Внешне
   * страницы не отличаются от обязательного раздела (те же мастера,
   * та же логика «или-или»), но входят в стоимость отдельно.
   *
   * В таблице xlsx это колонки `доп_1L..доп_5L`. У плотных листов есть
   * только у строк с максимальным количеством учеников; у мягких —
   * сдвинуто на 1 страницу вправо (первая страница `-`).
   *
   * Длина 0..5. Пустой массив = доп раздел не предусмотрен для этой
   * комбинации (например Лайт плотные 13-15 учеников).
   *
   * Каждый элемент может быть null если в таблице стоит `-` (пропуск
   * конкретной страницы). Это редкий случай — у мягких первая страница
   * `-` (мы её просто не строим, начинаем со второй).
   */
  additional_pages: (PageDescriptor | null)[];
}

// ─── Шаблоны страниц (для DRY) ──────────────────────────────────────────────

/**
 * «2 по 1/4 класса» — J-Quarter-Left на левой странице, J-Quarter-Right на правой.
 * Зеркальный выбор делает engine в common-required.ts через позицию страницы.
 * Здесь храним «левый» вариант — engine при необходимости подменит имя.
 */
const TWO_QUARTERS: PageDescriptor = [
  { master: 'J-Quarter-Left', category: 'quarter', count: 2 },
];

/** «2 по 1/2 класса» — J-Half (мастер симметричный, зеркала нет). */
const TWO_HALVES: PageDescriptor = [
  { master: 'J-Half', category: 'half_class', count: 2 },
];

/** «1 общая» — J-Full (мастер симметричный). */
const ONE_FULL: PageDescriptor = [
  { master: 'J-Full', category: 'full_class', count: 1 },
];

/** «либо 6 фото 1/6, либо 2 по 1/2 класса, либо 1 общая». */
const COLLAGE_OR_HALVES_OR_FULL: PageDescriptor = [
  { master: 'J-Collage-6', category: 'sixth', count: 6 },
  { master: 'J-Half', category: 'half_class', count: 2 },
  { master: 'J-Full', category: 'full_class', count: 1 },
];

/**
 * «Либо 1/4 класса, либо 6 фото 1/6, либо 2 по 1/2 класса, либо 1 общая».
 * РЭ.21.8.10: используется в доп. разделе на 3-4 страницах.
 * Quarter мастер берётся в Left-варианте; engine на правой странице
 * заменяет на Right (через pickRightVariant в common-required.ts).
 */
const QUARTERS_OR_COLLAGE_OR_HALVES_OR_FULL: PageDescriptor = [
  { master: 'J-Quarter-Left', category: 'quarter', count: 2 },
  { master: 'J-Collage-6', category: 'sixth', count: 6 },
  { master: 'J-Half', category: 'half_class', count: 2 },
  { master: 'J-Full', category: 'full_class', count: 1 },
];

/**
 * РЭ.21.8.10: шаблоны дополнительного общего раздела.
 *
 * ADDITIONAL_HARD — для плотных листов. 4 страницы:
 *   1L: «6×1/6 либо 2×1/2 либо 1 общая»
 *   2R: «6×1/6 либо 2×1/2 либо 1 общая»
 *   3L: «1/4 либо 6×1/6 либо 2×1/2 либо 1 общая»
 *   4R: «1/4 либо 6×1/6 либо 2×1/2 либо 1 общая»
 *
 * ADDITIONAL_SOFT — для мягких листов. 5 «позиций» но первая null
 * (доп раздел у мягких начинается со 2-й страницы, чтобы попасть на
 * правую сторону разворота). Engine при null просто не строит страницу,
 * pageInstances накапливается со следующей.
 *   1L: пропуск (null)
 *   2R: «6×1/6 либо 2×1/2 либо 1 общая»
 *   3L: «1/4 либо 6×1/6 либо 2×1/2 либо 1 общая»
 *   4R: «1/4 либо 6×1/6 либо 2×1/2 либо 1 общая»
 *   5L: «6×1/6 либо 2×1/2 либо 1 общая»
 */
const ADDITIONAL_HARD: (PageDescriptor | null)[] = [
  COLLAGE_OR_HALVES_OR_FULL,
  COLLAGE_OR_HALVES_OR_FULL,
  QUARTERS_OR_COLLAGE_OR_HALVES_OR_FULL,
  QUARTERS_OR_COLLAGE_OR_HALVES_OR_FULL,
];

const ADDITIONAL_SOFT: (PageDescriptor | null)[] = [
  null,
  COLLAGE_OR_HALVES_OR_FULL,
  QUARTERS_OR_COLLAGE_OR_HALVES_OR_FULL,
  QUARTERS_OR_COLLAGE_OR_HALVES_OR_FULL,
  COLLAGE_OR_HALVES_OR_FULL,
];

/** Пустой доп раздел — для строк где он не предусмотрен. */
const NO_ADDITIONAL: (PageDescriptor | null)[] = [];

// ─── Эталонная таблица OkeyBook ─────────────────────────────────────────────

/**
 * Полная таблица из xlsx (Сергей, 19.05.2026). Порядок строк соответствует
 * порядку в файле. Каждая строка — `[density, sheet_type, students_match, pages]`.
 *
 * Изменения относительно xlsx (документация):
 *   - «Стандарт+Универсал» в xlsx — одна строка с двумя комплектациями.
 *     Здесь это две записи (density='standard' и density='universal') с
 *     одинаковыми pages.
 *   - Колонка «Индивидуальная» в xlsx отсутствует. Решение Сергея
 *     (19.05.2026): использовать логику Максимум — добавляем 2 записи с
 *     density='maximum' (если/когда presets.density для individual будет
 *     создан как тип, добавим отдельные записи).
 */
export const OKEYBOOK_TABLE: TableRow[] = [
  // ─── Мини плотные ───────────────────────────────────────────────────────
  {
    density: 'mini',
    sheet_type: 'hard',
    students_match: { kind: 'ranges', ranges: [[1, 24]] },
    pages: [TWO_HALVES, COLLAGE_OR_HALVES_OR_FULL],
    additional_pages: ADDITIONAL_HARD,
  },
  {
    density: 'mini',
    sheet_type: 'hard',
    students_match: { kind: 'ranges', ranges: [[25, 28]] },
    pages: [], // обязательного общего раздела нет
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'mini',
    sheet_type: 'hard',
    students_match: { kind: 'ranges', ranges: [[29, 36]] },
    pages: [], // обязательного общего раздела нет
    additional_pages: NO_ADDITIONAL,
  },

  // ─── Мини мягкие ───────────────────────────────────────────────────────
  {
    density: 'mini',
    sheet_type: 'soft',
    students_match: { kind: 'ranges', ranges: [[1, 24]] },
    pages: [TWO_HALVES, COLLAGE_OR_HALVES_OR_FULL, ONE_FULL],
    additional_pages: ADDITIONAL_SOFT,
  },
  {
    density: 'mini',
    sheet_type: 'soft',
    students_match: { kind: 'ranges', ranges: [[25, 28]] },
    pages: [TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'mini',
    sheet_type: 'soft',
    students_match: { kind: 'ranges', ranges: [[29, 36]] },
    pages: [TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },

  // ─── Лайт плотные ──────────────────────────────────────────────────────
  {
    density: 'light',
    sheet_type: 'hard',
    students_match: {
      kind: 'ranges',
      ranges: [
        [1, 12],
        [22, 24],
      ],
    },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
      TWO_HALVES,
    ],
    additional_pages: ADDITIONAL_HARD,
  },
  {
    density: 'light',
    sheet_type: 'hard',
    students_match: {
      kind: 'ranges',
      ranges: [
        [13, 15],
        [25, 28],
      ],
    },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES, COLLAGE_OR_HALVES_OR_FULL],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'light',
    sheet_type: 'hard',
    students_match: { kind: 'ranges', ranges: [[16, 18]] },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES, COLLAGE_OR_HALVES_OR_FULL],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'light',
    sheet_type: 'hard',
    students_match: {
      kind: 'ranges',
      ranges: [
        [19, 21],
        [31, 33],
      ],
    },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
      TWO_HALVES,
    ],
    additional_pages: NO_ADDITIONAL,
  },

  // ─── Лайт мягкие ───────────────────────────────────────────────────────
  {
    density: 'light',
    sheet_type: 'soft',
    students_match: {
      kind: 'ranges',
      ranges: [
        [1, 12],
        [22, 24],
      ],
    },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
    ],
    additional_pages: ADDITIONAL_SOFT,
  },
  {
    density: 'light',
    sheet_type: 'soft',
    students_match: {
      kind: 'ranges',
      ranges: [
        [13, 15],
        [25, 28],
      ],
    },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'light',
    sheet_type: 'soft',
    students_match: { kind: 'ranges', ranges: [[16, 18]] },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'light',
    sheet_type: 'soft',
    students_match: { kind: 'ranges', ranges: [[19, 21]] },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },

  // ─── Медиум плотные ────────────────────────────────────────────────────
  {
    density: 'medium',
    sheet_type: 'hard',
    students_match: {
      kind: 'ranges',
      ranges: [
        [7, 8],
        [15, 16],
        [23, 24],
        [31, 32],
      ],
    },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
      TWO_HALVES,
    ],
    additional_pages: ADDITIONAL_HARD,
  },
  {
    density: 'medium',
    sheet_type: 'hard',
    students_match: {
      kind: 'ranges',
      ranges: [
        [9, 10],
        [17, 18],
        [25, 26],
      ],
    },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES, COLLAGE_OR_HALVES_OR_FULL],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'medium',
    sheet_type: 'hard',
    students_match: {
      kind: 'ranges',
      ranges: [
        [11, 12],
        [19, 20],
        [27, 28],
      ],
    },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES, COLLAGE_OR_HALVES_OR_FULL],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'medium',
    sheet_type: 'hard',
    students_match: {
      kind: 'ranges',
      ranges: [
        [13, 14],
        [21, 22],
        [29, 30],
      ],
    },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
      TWO_HALVES,
    ],
    additional_pages: NO_ADDITIONAL,
  },

  // ─── Медиум мягкие ─────────────────────────────────────────────────────
  {
    density: 'medium',
    sheet_type: 'soft',
    students_match: {
      kind: 'ranges',
      ranges: [
        [7, 8],
        [15, 16],
        [23, 24],
        [31, 32],
      ],
    },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
    ],
    additional_pages: ADDITIONAL_SOFT,
  },
  {
    density: 'medium',
    sheet_type: 'soft',
    students_match: {
      kind: 'ranges',
      ranges: [
        [9, 10],
        [17, 18],
        [25, 26],
      ],
    },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'medium',
    sheet_type: 'soft',
    students_match: {
      kind: 'ranges',
      ranges: [
        [11, 12],
        [19, 20],
        [27, 28],
      ],
    },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'medium',
    sheet_type: 'soft',
    students_match: {
      kind: 'ranges',
      ranges: [
        [13, 14],
        [21, 22],
        [29, 30],
      ],
    },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },

  // ─── Стандарт + Универсал плотные ──────────────────────────────────────
  // xlsx: одна строка для двух комплектаций. Здесь дублируем для каждой.
  {
    density: 'standard',
    sheet_type: 'hard',
    students_match: { kind: 'parity', parity: 'even' },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
      TWO_HALVES,
    ],
    additional_pages: ADDITIONAL_HARD,
  },
  {
    density: 'standard',
    sheet_type: 'hard',
    students_match: { kind: 'parity', parity: 'odd' },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES, COLLAGE_OR_HALVES_OR_FULL],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'universal',
    sheet_type: 'hard',
    students_match: { kind: 'parity', parity: 'even' },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
      TWO_HALVES,
    ],
    additional_pages: ADDITIONAL_HARD,
  },
  {
    density: 'universal',
    sheet_type: 'hard',
    students_match: { kind: 'parity', parity: 'odd' },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES, COLLAGE_OR_HALVES_OR_FULL],
    additional_pages: NO_ADDITIONAL,
  },

  // ─── Стандарт + Универсал мягкие ───────────────────────────────────────
  {
    density: 'standard',
    sheet_type: 'soft',
    students_match: { kind: 'parity', parity: 'even' },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
    ],
    additional_pages: ADDITIONAL_SOFT,
  },
  {
    density: 'standard',
    sheet_type: 'soft',
    students_match: { kind: 'parity', parity: 'odd' },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },
  {
    density: 'universal',
    sheet_type: 'soft',
    students_match: { kind: 'parity', parity: 'even' },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
    ],
    additional_pages: ADDITIONAL_SOFT,
  },
  {
    density: 'universal',
    sheet_type: 'soft',
    students_match: { kind: 'parity', parity: 'odd' },
    pages: [TWO_QUARTERS, TWO_QUARTERS, TWO_HALVES],
    additional_pages: NO_ADDITIONAL,
  },

  // ─── Максимум плотные ──────────────────────────────────────────────────
  // density='maximum' для категории Максимум. Для Индивидуальной комплектации
  // (которой в xlsx нет) использовать ту же строку — РЭ.21.8 фаза 21.8.11/12
  // решит как именно (Сергей, 19.05.2026).
  {
    density: 'maximum',
    sheet_type: 'hard',
    students_match: { kind: 'any' },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
      TWO_HALVES,
    ],
    additional_pages: ADDITIONAL_HARD,
  },

  // ─── Максимум мягкие ───────────────────────────────────────────────────
  {
    density: 'maximum',
    sheet_type: 'soft',
    students_match: { kind: 'any' },
    pages: [
      TWO_QUARTERS,
      TWO_QUARTERS,
      TWO_HALVES,
      COLLAGE_OR_HALVES_OR_FULL,
      COLLAGE_OR_HALVES_OR_FULL,
    ],
    additional_pages: ADDITIONAL_SOFT,
  },
];

// ─── Парсер / matcher ──────────────────────────────────────────────────────

/**
 * Подходит ли заданное количество учеников под описание `match`.
 */
export function matchStudents(match: StudentsMatch, count: number): boolean {
  switch (match.kind) {
    case 'any':
      return true;
    case 'ranges':
      for (let i = 0; i < match.ranges.length; i++) {
        const [lo, hi] = match.ranges[i];
        if (count >= lo && count <= hi) return true;
      }
      return false;
    case 'parity':
      if (match.parity === 'even') return count % 2 === 0;
      return count % 2 === 1;
  }
}

/**
 * Найти строку таблицы для заданной (density × sheet_type × количество учеников).
 *
 * Возвращает первую подходящую строку или null если ничего не подошло
 * (например для density=null или нераспознанного sheet_type).
 *
 * Для density='maximum' и students_match='any' возвращается строка без
 * проверки точного числа учеников — это документировано как «не важно,
 * так как личный раздел занимает весь разворот».
 *
 * Density-параметр шире чем PresetDensity (включает 'maximum'). Для
 * Индивидуальной комплектации (которой нет в xlsx) caller должен передавать
 * 'maximum' (решение Сергея 19.05.2026).
 */
export function pickRow(
  density: Density | PresetDensity | null | undefined,
  sheet_type: SheetType | null | undefined,
  students_count: number,
): TableRow | null {
  if (!density || !sheet_type) return null;
  for (let i = 0; i < OKEYBOOK_TABLE.length; i++) {
    const row = OKEYBOOK_TABLE[i];
    if (row.density !== density) continue;
    if (row.sheet_type !== sheet_type) continue;
    if (!matchStudents(row.students_match, students_count)) continue;
    return row;
  }
  return null;
}
