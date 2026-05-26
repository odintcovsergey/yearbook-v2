// РЭ.53: глобальные стили текстов альбома.
//
// Группы покрывают типы placeholder'ов которые должны иметь общий стиль
// (size + color). Партнёр задаёт стиль один раз для группы — engine /
// canvas применяют ко всем placeholder'ам этой группы.

/**
 * Список глобальных групп.
 * Каждое значение — ключ в albums.text_style_overrides (JSONB).
 */
export const TEXT_STYLE_GROUPS = [
  'studentname',
  'studentquote',
  'teachername',
  'teacherrole',
  'headteachername',
  'headtextframe',
] as const;

export type TextStyleGroup = (typeof TEXT_STYLE_GROUPS)[number];

/**
 * Override для одной группы. Все поля опциональны: если не задано —
 * fallback на placeholder.font_size_pt / placeholder.color.
 */
export interface TextStyleGroupOverride {
  /** Мультипликатор размера в процентах (50..200). null/undefined = не трогать. */
  size_pct: number | null;
  /** HEX строка "#RRGGBB". null/undefined = не трогать (placeholder color). */
  color: string | null;
}

/**
 * Тип значения колонки albums.text_style_overrides.
 * Каждый ключ — группа, значение — override (или null если группа не настроена).
 * Сам объект может быть null (legacy альбомы где партнёр ничего не настраивал).
 */
export type AlbumTextStyleOverrides = {
  [K in TextStyleGroup]?: TextStyleGroupOverride | null;
};

/**
 * Парсит JSONB из БД в типизированный объект. Возвращает {} если
 * значение null/undefined/невалидное — caller трактует это как
 * "никаких глобальных override'ов".
 */
export function parseAlbumTextStyleOverrides(
  raw: unknown,
): AlbumTextStyleOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const result: AlbumTextStyleOverrides = {};
  const obj = raw as Record<string, unknown>;
  for (const group of TEXT_STYLE_GROUPS) {
    const v = obj[group];
    if (!v || typeof v !== 'object') continue;
    const entry = v as Record<string, unknown>;
    const sizePct =
      typeof entry.size_pct === 'number' &&
      Number.isFinite(entry.size_pct) &&
      entry.size_pct >= 50 &&
      entry.size_pct <= 200
        ? Math.round(entry.size_pct)
        : null;
    const color =
      typeof entry.color === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(entry.color)
        ? entry.color.toUpperCase()
        : null;
    // Сохраняем группу только если хотя бы одно значение задано.
    if (sizePct === null && color === null) continue;
    result[group] = { size_pct: sizePct, color };
  }
  return result;
}

/**
 * Определяет к какой группе принадлежит placeholder label.
 *
 * Маппинг:
 *   studentname_N     → 'studentname'
 *   studentquote_N    → 'studentquote'
 *   teachername_N     → 'teachername'
 *   subjectname_N     → 'teachername'
 *   teacherrole_N     → 'teacherrole'
 *   subjectrole_N     → 'teacherrole'
 *   headteacherrole   → 'teacherrole'
 *   headteachername   → 'headteachername'
 *   headtextframe     → 'headtextframe'
 *   (всё остальное)   → null (не покрыто глобальными стилями)
 *
 * Сравнение case-insensitive. Trailing цифры опциональны.
 */
export function detectTextStyleGroup(label: string): TextStyleGroup | null {
  if (!label) return null;
  const lower = label.toLowerCase();
  // Точные labels (без числового суффикса) проверяем первыми.
  if (lower === 'headteachername') return 'headteachername';
  if (lower === 'headtextframe') return 'headtextframe';
  if (lower === 'headteacherrole') return 'teacherrole';
  // Префиксные с числом.
  if (/^studentname(_\d+)?$/.test(lower)) return 'studentname';
  if (/^studentquote(_\d+)?$/.test(lower)) return 'studentquote';
  if (/^teachername(_\d+)?$/.test(lower)) return 'teachername';
  if (/^subjectname(_\d+)?$/.test(lower)) return 'teachername';
  if (/^teacherrole(_\d+)?$/.test(lower)) return 'teacherrole';
  if (/^subjectrole(_\d+)?$/.test(lower)) return 'teacherrole';
  return null;
}

/**
 * Применяет каскад глобальный → точечный для размера текста.
 *
 *   point  — точечный override из spread data (data[__fontSize__<label>]),
 *            multiplier (e.g. 1.1) или null если нет.
 *   global — глобальный override из albums.text_style_overrides для
 *            группы placeholder'а (e.g. size_pct=110) или null.
 *
 * Приоритет:
 *   1. Если point !== null → point (точка побеждает глобал)
 *   2. Иначе если global.size_pct !== null → global / 100
 *   3. Иначе 1 (default — placeholder.font_size_pt без модификации)
 */
export function resolveFontSizeMult(
  point: number | null,
  global: TextStyleGroupOverride | null | undefined,
): number {
  if (point !== null && point !== undefined) return point;
  if (global && typeof global.size_pct === 'number') {
    return global.size_pct / 100;
  }
  return 1;
}

/**
 * Применяет каскад глобальный → точечный для цвета текста.
 *
 *   point  — точечный override из data[__color__<label>], '#RRGGBB' или null.
 *   global — глобальный override для группы или null.
 *
 * Приоритет:
 *   1. point !== null → point
 *   2. иначе global.color || null
 *   3. caller fallback на placeholder.color
 */
export function resolveColor(
  point: string | null,
  global: TextStyleGroupOverride | null | undefined,
): string | null {
  if (point !== null && point !== undefined) return point;
  if (global && typeof global.color === 'string') return global.color;
  return null;
}
