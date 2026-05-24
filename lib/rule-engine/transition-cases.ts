/**
 * РЭ.37.2.a — классификатор переходного раздела.
 *
 * Чистая функция, описывающая ЧТО должно лежать на хвостовой части
 * раздела учеников при заданной комплектации и количестве учеников.
 * Без привязки к pageInstances, без побочных эффектов — pure logic.
 *
 * ИДЕЯ
 * ─────
 * Раздел учеников всегда укладывает фиксированное количество страниц
 * (определяется N — capacity сетки или 1 для индивидуальных). Хвост
 * (остаток учеников, не уместившихся в полные страницы) может попасть
 * на разные позиции разворота, и решение «как закрыть» зависит от
 * комплектации и размера хвоста.
 *
 * Эта функция возвращает «логический результат» — что должно быть
 * нарисовано на хвостовой странице и нужна ли дополнительная страница
 * для закрытия разворота. Решение «кто это рисует» (sections/students
 * или sections/transition) и «как привязать к pageInstances»
 * принимается уровнем выше (в РЭ.37.2.b).
 *
 * ВЫРАЖЕННЫЕ В КОДЕ РЕШЕНИЯ СЕРГЕЯ (24.05.2026)
 * ─────────────────────────────────────────────
 *   • Комплектация = характеристика шаблона (выводится из мастеров
 *     students-секции). Сюда передаётся уже определённой.
 *   • Combo-мастер активен только когда tail ≤ M (capacity combo).
 *     Если tail > M — на хвостовой странице обычная N-Grid с
 *     placeholder-padding.
 *   • Для случая full=0, tail 1..M (мало учеников всего) — тоже combo,
 *     не «полупустая сетка». Симметрично case 4 (full=2+ чёт + tail≤M).
 *   • J-цепочка — порядок попыток (half_class → sixth → full_class),
 *     движок выбирает первую с достаточным фото в пуле.
 *   • Не-сеточные комплектации (standard / universal) не используют
 *     combo — N=1, хвост невозможен, нужна только J-цепочка для
 *     закрытия разворота при нечётном число полных страниц.
 *   • Maximum: каждый ученик занимает разворот (2 страницы), число
 *     страниц students всегда чётное, transition не активируется.
 *
 * НОВАЯ ЛОГИКА vs ИСТОРИЧЕСКАЯ XLSX (важно)
 * ─────────────────────────────────────────
 * В таблице docs/transition-section-spec.xlsx строки «до 24 (Мини)»
 * и «до 12 (Лайт)» помечены как transition off — это историческое
 * правило под РУЧНОЙ труд дизайнера. Для автоматической верстки
 * Сергей зафиксировал: даже при малом количестве учеников переходный
 * раздел нужен (заполняет правую страницу разворота, чтобы не висела
 * пустая). Эта функция реализует новую (автоматическую) логику.
 *
 * РАЗМЕТКА СЛУЧАЕВ
 * ────────────────
 * Возвращаемая структура содержит два независимых поля:
 *
 *   tail_page — что на хвостовой странице (если хвост > 0):
 *     - 'none'         : tail = 0, хвостовой страницы нет
 *     - 'combo'        : combo-мастер на N портретов (M слотов; (M-tail)
 *                        слотов __hidden__). Это случаи 2 и 4 моей таблицы.
 *     - 'grid_padded'  : обычная N-Grid с tail портретами + (N-tail)
 *                        placeholder-padding ячейками (случаи 3 и 5).
 *                        Делает sections/students с placeholder_centering.
 *     - 'last_e_student' : для standard/universal — последняя страница
 *                          E-Student с одним учеником. Хвоста как такового
 *                          у них нет (N=1), но логически последняя
 *                          страница может оказаться нечётной по позиции,
 *                          и transition закрывает её соседку.
 *
 *   closing_page — нужна ли дополнительная страница для закрытия:
 *     - 'none'         : разворот закрылся ровно, transition не нужен
 *     - 'j_chain'      : нужна правая закрывающая страница с J-цепочкой
 *                        (порядок: half_class → sixth → full_class).
 *
 * ПРИВЯЗКА К ПОЗИЦИЯМ (L / R) — НЕ ЗДЕСЬ
 * ──────────────────────────────────────
 * Эта функция не знает, на какой физической позиции (L/R) окажется
 * хвостовая страница — это зависит от чётности страниц до начала
 * students-секции (soft_intro + teachers + ...). Решение принимает b.
 *
 * Связано с предположением OkeyBook: students-секция всегда начинается
 * с левой страницы разворота (после teachers, которые занимают чётное
 * число страниц). При нарушении этого инварианта (если конкретный
 * пресет даст нечётное число страниц до students) — b сгенерирует
 * warning, и логика combo на L vs R перевернётся естественным образом.
 */

/**
 * Комплектация шаблона. Определяется по мастерам students-секции:
 *   • 'mini'      — N-Grid-12 (12 портретов в сетке на странице)
 *   • 'light'     — N-Grid-6  (6 портретов)
 *   • 'medium'    — N-Grid-4  (4 портрета)
 *   • 'standard'  — E-Student без слотов друзей (1 ученик/страница)
 *   • 'universal' — E-Student с слотами друзей (1 ученик/страница)
 *   • 'maximum'   — M-Student-Spread (разворот на ученика)
 */
export type Complectation =
  | 'mini'
  | 'light'
  | 'medium'
  | 'standard'
  | 'universal'
  | 'maximum';

/** Что должно быть на хвостовой странице (после полных). */
export type TailPageKind =
  | 'none'
  | 'combo'
  | 'grid_padded';

/** Нужна ли дополнительная закрывающая страница. */
export type ClosingPageKind = 'none' | 'j_chain';

export interface TransitionLayout {
  /** Сколько полных страниц с учениками положит students-секция. */
  full_pages: number;
  /** Сколько учеников не уместилось в полные страницы (0..N-1). */
  tail: number;
  /**
   * Что должно быть на хвостовой странице.
   * Когда tail=0, всегда 'none' (полные страницы — это work students).
   */
  tail_page: TailPageKind;
  /**
   * Только при tail_page='combo': имя БАЗОВОГО мастера (без -Right
   * суффикса). Engine при привязке к позиции выберет -Right вариант
   * для правой страницы по конвенции имени.
   *
   *   'J-Combined-Tail-4' (Mini, M=4)
   *   'J-Combined-Tail-3' (Light, M=3)
   *   'J-Combined-Tail-2' (Medium, M=2)
   */
  combo_master_base: string | null;
  /**
   * Только при tail_page='combo': capacity combo-мастера (M).
   * Engine использует для (M - tail) __hidden__ слотов.
   */
  combo_capacity: number | null;
  /** Нужна ли закрывающая страница на свободной стороне разворота. */
  closing_page: ClosingPageKind;
}

// ───── константы комплектаций ─────────────────────────────────────────

interface ComplectationSpec {
  /** Учеников на странице (N). У 'maximum' — учеников на разворот. */
  per_page: number;
  /**
   * Capacity combo-мастера (M < N). null = combo не применяется
   * (для standard / universal / maximum).
   */
  combo_capacity: number | null;
  /** Базовое имя combo-мастера или null. */
  combo_master_base: string | null;
  /** true если каждый ученик занимает развёрнутые 2 страницы (Maximum). */
  spread_per_student: boolean;
}

const SPECS: Record<Complectation, ComplectationSpec> = {
  mini: {
    per_page: 12,
    combo_capacity: 4,
    combo_master_base: 'J-Combined-Tail-4',
    spread_per_student: false,
  },
  light: {
    per_page: 6,
    combo_capacity: 3,
    combo_master_base: 'J-Combined-Tail-3',
    spread_per_student: false,
  },
  medium: {
    per_page: 4,
    combo_capacity: 2,
    combo_master_base: 'J-Combined-Tail-2',
    spread_per_student: false,
  },
  standard: {
    per_page: 1,
    combo_capacity: null,
    combo_master_base: null,
    spread_per_student: false,
  },
  universal: {
    per_page: 1,
    combo_capacity: null,
    combo_master_base: null,
    spread_per_student: false,
  },
  maximum: {
    per_page: 1,
    combo_capacity: null,
    combo_master_base: null,
    spread_per_student: true,
  },
};

/**
 * Главная функция фазы РЭ.37.2.
 *
 * Принимает комплектацию шаблона и число учеников. Возвращает «логическую
 * раскладку» — что должно лежать на разворотах в результате работы
 * sections/students + sections/transition.
 *
 * Не учитывает чётность страниц до students-секции — это работа уровня
 * выше (привязка к pageInstances в sections/transition.ts).
 */
export function classifyTransitionLayout(
  complectation: Complectation,
  students_count: number,
): TransitionLayout {
  if (!Number.isInteger(students_count) || students_count < 0) {
    throw new Error(
      `classifyTransitionLayout: students_count должен быть неотрицательным целым, получено ${students_count}`,
    );
  }
  const spec = SPECS[complectation];

  // ─── Maximum: каждый ученик = разворот (2 страницы) ──────────────────
  // Раздел учеников всегда занимает чётное число страниц. Transition
  // не нужен ни в одном случае.
  if (spec.spread_per_student) {
    return {
      full_pages: students_count * 2,
      tail: 0,
      tail_page: 'none',
      combo_master_base: null,
      combo_capacity: null,
      closing_page: 'none',
    };
  }

  // ─── Standard / Universal: 1 ученик на страницу ──────────────────────
  // Хвоста нет (N=1), tail всегда 0. closing_page = j_chain если число
  // страниц нечётное (последний ученик висит на левой, нужна J на правой).
  // По решению Сергея (Q3): на левой переходного раздела движок ничего
  // не кладёт — там уже стоит последняя страница E-Student от
  // students-секции. closing_page закрывает соседнюю правую через
  // J-цепочку.
  if (spec.combo_capacity === null) {
    const full_pages = students_count;
    const needs_closing = full_pages % 2 === 1;
    return {
      full_pages,
      tail: 0,
      tail_page: 'none',
      combo_master_base: null,
      combo_capacity: null,
      closing_page: needs_closing ? 'j_chain' : 'none',
    };
  }

  // ─── Сеточные комплектации: Mini / Light / Medium ────────────────────
  const N = spec.per_page;
  const M = spec.combo_capacity;
  const full_pages = Math.floor(students_count / N);
  const tail = students_count % N;

  // tail = 0: хвостовой страницы нет. closing_page нужен, если число
  // полных нечётное (последняя полная висит, нужен J на свободной).
  if (tail === 0) {
    const needs_closing = full_pages % 2 === 1;
    return {
      full_pages,
      tail: 0,
      tail_page: 'none',
      combo_master_base: null,
      combo_capacity: null,
      closing_page: needs_closing ? 'j_chain' : 'none',
    };
  }

  // tail > 0 и tail ≤ M: combo-мастер заменяет хвостовую страницу.
  // closing_page нужен всегда: хвост + closing закрывают разворот
  // (если full чёт) или хвост сам закрывает разворот а closing идёт
  // на следующий (если full нечёт). В обоих случаях нужна J на R.
  //
  // ИСКЛЮЧЕНИЕ: full нечёт + tail≤M → хвостовая страница сама ляжет
  // на правую (закроет разворот), и J-цепочка НЕ нужна. Этот случай
  // в моей таблице — case 7 (Light 19-21, Medium 13-14). Чётность
  // полных определяется уровнем выше, но из xlsx видно: для full нечёт
  // J-цепочка отсутствует. Поэтому здесь решение проще описать как
  // «всегда true», а уровень выше при привязке к pageInstances увидит
  // что разворот закрылся combo и сам пропустит closing.
  //
  // Для определённости: эта функция возвращает closing='j_chain' для
  // всех tail>0. Привязочный уровень (b) при необходимости даунгрейдит
  // до 'none' если разворот уже закрылся хвостовой страницей.
  if (tail <= M) {
    return {
      full_pages,
      tail,
      tail_page: 'combo',
      combo_master_base: spec.combo_master_base,
      combo_capacity: M,
      closing_page: 'j_chain',
    };
  }

  // tail > M: combo не подходит. Хвостовая страница — обычная N-Grid
  // с placeholder-padding (sections/students с placeholder_centering).
  // closing_page = j_chain аналогично.
  return {
    full_pages,
    tail,
    tail_page: 'grid_padded',
    combo_master_base: null,
    combo_capacity: null,
    closing_page: 'j_chain',
  };
}
