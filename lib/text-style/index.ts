/**
 * lib/text-style — override стиля текстового placeholder'а (Р.3).
 *
 * Партнёр может изменить размер и цвет уже существующего текста
 * прямо в редакторе. Override хранится в служебных ключах
 * spreads[].data рядом с __scale__/__offset__/__rotate__:
 *
 *   __fontSize__<label>  — мультипликатор размера шрифта,
 *                          диапазон [FONT_SIZE_MULT_MIN, FONT_SIZE_MULT_MAX].
 *                          Финальный размер = placeholder.font_size_pt * mult.
 *                          Мультипликатор, а не абсолют, потому что:
 *                          1) при смене мастера значение остаётся «осмысленным»
 *                             (50% от нового font_size_pt > 50% от старого, а
 *                             абсолютные значения дают катастрофически плохие
 *                             пропорции);
 *                          2) дизайнер выбирает базовый размер; партнёр
 *                             только корректирует относительно.
 *
 *   __color__<label>     — override цвета как HEX-строка (с # или без).
 *                          Палитра фиксированная (TEXT_STYLE_PALETTE) —
 *                          даёт партнёру предсказуемые качественные цвета
 *                          без риска «фиолетовый на красном фоне».
 *
 * Default = отсутствие ключа → fontSizeMult=1.0, color=null (берётся
 * placeholder.color из IDML).
 *
 * См. также: docs/phase-content-edit-spec.md (КЭ — кадрирование фото),
 * lib/photo-transform/index.ts (КЭ + Р.2 — поворот фото).
 */

// ─── Размер шрифта (мультипликатор) ─────────────────────────────────────

/** Минимальный мультипликатор размера шрифта. 50% от базового. */
export const FONT_SIZE_MULT_MIN = 0.5;
/** Максимальный мультипликатор размера шрифта. 200% от базового. */
export const FONT_SIZE_MULT_MAX = 2.0;
/** Default мультипликатор (без override). */
export const FONT_SIZE_MULT_DEFAULT = 1.0;

/**
 * Парсит мультипликатор размера шрифта из data-значения.
 * Возвращает 1.0 для undefined/null/некорректных входов, иначе clamp
 * в [FONT_SIZE_MULT_MIN, FONT_SIZE_MULT_MAX].
 */
export function parseFontSizeMult(v: unknown): number {
  if (v === null || v === undefined) return FONT_SIZE_MULT_DEFAULT;
  // Пустая строка/whitespace → default (Number('') === 0, что иначе
  // clamp'нулось бы в FONT_SIZE_MULT_MIN).
  if (typeof v === 'string' && v.trim() === '') return FONT_SIZE_MULT_DEFAULT;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return FONT_SIZE_MULT_DEFAULT;
  return clamp(n, FONT_SIZE_MULT_MIN, FONT_SIZE_MULT_MAX);
}

/**
 * Сериализует мультипликатор в string. Округление до 3 знаков —
 * UI step=0.05 (5%), но защищаемся от плавающей точки.
 */
export function serializeFontSizeMult(mult: number): string {
  const m = clamp(mult, FONT_SIZE_MULT_MIN, FONT_SIZE_MULT_MAX);
  return m.toFixed(3).replace(/\.?0+$/, '');
}

// ─── Цвет (палитра) ──────────────────────────────────────────────────

/**
 * Палитра цветов для override текста (Р.3). 10 фиксированных цветов.
 * Партнёр выбирает из этого списка — UI не показывает свободный picker,
 * чтобы избежать «фиолетовый на красном фоне».
 *
 * Состав: ахроматические (чёрный, тёмно-серый, серый, белый) +
 * классические для выпускных альбомов (тёмно-синий, тёмно-зелёный,
 * бордовый, тёмно-коричневый, золотой, фиолетовый).
 */
export const TEXT_STYLE_PALETTE: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#000000', name: 'Чёрный' },
  { hex: '#444444', name: 'Тёмно-серый' },
  { hex: '#888888', name: 'Серый' },
  { hex: '#FFFFFF', name: 'Белый' },
  { hex: '#1F4E79', name: 'Тёмно-синий' },
  { hex: '#196F3D', name: 'Тёмно-зелёный' },
  { hex: '#C0392B', name: 'Бордовый' },
  { hex: '#7B4F1B', name: 'Тёмно-коричневый' },
  { hex: '#B8902F', name: 'Золотой' },
  { hex: '#6C3483', name: 'Фиолетовый' },
] as const;

/**
 * Парсит HEX из data-значения. Принимает форматы '#RRGGBB', 'RRGGBB',
 * '#RGB', 'RGB'. Возвращает строку '#RRGGBB' в верхнем регистре или
 * null если значение некорректное.
 *
 * Возвращает null также для пустых строк и значений вне HEX-формата —
 * caller трактует null как «нет override, использовать placeholder.color».
 */
export function parseColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  // #RRGGBB
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
    return withHash.toUpperCase();
  }
  // #RGB → расширяем до #RRGGBB
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const r = withHash.charAt(1);
    const g = withHash.charAt(2);
    const b = withHash.charAt(3);
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

/**
 * Сериализует HEX для записи в data. Принимает любой формат который
 * понимает parseColor, возвращает '#RRGGBB' в верхнем регистре или
 * null если значение некорректное. Для null — null (caller удалит ключ).
 */
export function serializeColor(hex: string | null): string | null {
  if (hex === null) return null;
  return parseColor(hex);
}

/**
 * Возвращает true если в палитре есть указанный цвет (case-insensitive).
 * Используется в UI чтобы подсветить активный swatch.
 */
export function isColorInPalette(hex: string | null): boolean {
  if (!hex) return false;
  const normalized = parseColor(hex);
  if (!normalized) return false;
  return TEXT_STYLE_PALETTE.some((c) => c.hex.toUpperCase() === normalized);
}

// ─── Общие хелперы ──────────────────────────────────────────────────

/**
 * Возвращает true если стиль отличается от default.
 * Используется для индикации «текст стилизован» в UI бейджа и для
 * включения/отключения кнопки Сбросить.
 */
export function hasCustomTextStyle(
  fontSizeMult: number,
  colorOverride: string | null,
): boolean {
  return fontSizeMult !== FONT_SIZE_MULT_DEFAULT || colorOverride !== null;
}

/** Standard utility — clamp number в диапазон [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

// РЭ.53 — глобальные стили (на уровне альбома).
export {
  TEXT_STYLE_GROUPS,
  detectTextStyleGroup,
  parseAlbumTextStyleOverrides,
  resolveFontSizeMult,
  resolveColor,
} from './groups';
export type {
  TextStyleGroup,
  TextStyleGroupOverride,
  AlbumTextStyleOverrides,
} from './groups';
