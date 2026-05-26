// РЭ.55: curated список шрифтов доступных партнёру для выбора в редакторе.
//
// Все шрифты — Google Fonts с open-source лицензиями (SIL OFL / Apache 2.0).
// Файлы лежат в public/fonts/, зарегистрированы в:
//   • app/globals.css (@font-face — для Konva canvas + textarea в редакторе)
//   • lib/pdf-export/font-loader.ts (FontRegistry — для PDF embedding)
//
// Принцип: дизайнер в IDML может использовать ЛЮБОЙ шрифт. Парсер сохраняет
// font_family как строку в placeholder.font_family. Если шрифт есть в этом
// списке — отображается правильно. Если нет — fallback на noto-serif-regular
// (с warning'ом 'font_not_found' в PDF; в браузере CSS-fallback на serif).
//
// Партнёр в TextStylePanel и в AlbumTextStylesModal выбирает шрифт ТОЛЬКО
// из этого списка. Если ему нужен какой-то специфический шрифт для нового
// макета (например, детсадовский) — мы добавляем его сюда (+ TTF + globals.css
// + font-loader.ts).

/**
 * Семейство шрифта (то что хранится в БД как font_family — строка
 * без weight/italic информации).
 */
export interface FontFamilyOption {
  /** Внутреннее имя для хранения (= CSS font-family). */
  family: string;
  /** Лейбл в UI селекте. */
  label: string;
  /** Категория — для группировки/отсева в селекте. */
  category: 'serif' | 'sans' | 'handwritten' | 'decorative';
  /** Краткое описание (мб в tooltip или hint). */
  hint?: string;
}

/**
 * Curated список. Порядок задаёт порядок в селектах.
 *
 * Дефолт по умолчанию (если ни шаблон ни override не задают шрифт):
 * первый элемент списка (Noto Serif) — но на практике до этого fallback
 * не доходим, потому что у каждого placeholder.font_family заполнен
 * парсером из IDML.
 */
export const AVAILABLE_FONTS: FontFamilyOption[] = [
  {
    family: 'Noto Serif',
    label: 'Noto Serif',
    category: 'serif',
    hint: 'Классика с засечками — для имён, цитат',
  },
  {
    family: 'PT Serif',
    label: 'PT Serif',
    category: 'serif',
    hint: 'Книжный с засечками — для торжественных имён',
  },
  {
    family: 'Open Sans',
    label: 'Open Sans',
    category: 'sans',
    hint: 'Универсальный гротеск — для описаний',
  },
  {
    family: 'Roboto',
    label: 'Roboto',
    category: 'sans',
    hint: 'Технический гротеск — для подписей',
  },
  {
    family: 'Montserrat',
    label: 'Montserrat',
    category: 'sans',
    hint: 'Геометрический — для заголовков и акцентов',
  },
  {
    family: 'Caveat',
    label: 'Caveat',
    category: 'handwritten',
    hint: 'Рукописный — для подписей',
  },
  {
    family: 'Slimamif',
    label: 'Slimamif',
    category: 'decorative',
    hint: 'Декоративный — для надписей в детских макетах',
  },
];

/**
 * Список доступных family-строк (для быстрой проверки isAvailable).
 */
const AVAILABLE_FAMILIES = new Set(
  AVAILABLE_FONTS.map((f) => f.family.toLowerCase()),
);

/**
 * Проверяет, есть ли семейство в curated списке.
 * Сравнение case-insensitive.
 */
export function isAvailableFont(family: string | null | undefined): boolean {
  if (!family) return false;
  return AVAILABLE_FAMILIES.has(family.toLowerCase().trim());
}

/**
 * Парсит значение font_family из произвольного source
 * (data ключ __font__<label> или JSONB поле font_family).
 *
 * Возвращает каноническое family-имя из AVAILABLE_FONTS если match,
 * иначе null. Невалидные/неизвестные значения отбрасываются — нельзя
 * чтобы партнёр случайно записал в БД 'Comic Sans MS' и потом мы
 * пытались отрисовать это.
 */
export function parseFontFamily(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // Ищем case-insensitive matching канонический вариант.
  const lower = trimmed.toLowerCase();
  const found = AVAILABLE_FONTS.find((f) => f.family.toLowerCase() === lower);
  return found ? found.family : null;
}

/**
 * Применяет каскад глобальный → точечный для font_family.
 *
 *   point  — точечный override из data[__font__<label>] или null
 *   global — глобальный override для группы или null
 *
 * Приоритет:
 *   1. point !== null → point
 *   2. иначе global.font_family || null
 *   3. caller fallback на placeholder.font_family (из IDML)
 */
export function resolveFontFamily(
  point: string | null,
  global: { font_family?: string | null } | null | undefined,
): string | null {
  if (point !== null && point !== undefined) return point;
  if (global && global.font_family) return global.font_family;
  return null;
}
