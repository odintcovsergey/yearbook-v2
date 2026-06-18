/**
 * Глобальные стили текстов обложки (аналог albums.text_style_overrides для
 * разворотов, но для меток обложки). Партнёр в модалке «Стили текстов» задаёт
 * шрифт/размер/цвет/выравнивание по СМЫСЛОВЫМ группам (Заголовок, Имя
 * выпускника, Реквизиты …) — применяется ко ВСЕМ обложкам заказа сразу.
 *
 * Хранится в albums.cover_text_style_overrides (jsonb). Применение —
 * через служебные ключи __fontSize__/__color__/__halign__/__valign__/__font__
 * (как точечные правки), но как НИЖНИЙ слой: точечный клик по тексту его
 * переопределяет (см. applyCoverTextStyles — глобальный ключ ставится только
 * если точечного ещё нет).
 */

import {
  parseHAlign,
  parseVAlign,
  parseFontFamily,
  serializeFontSizeMult,
  type TextStyleGroupOverride,
} from '@/lib/text-style';
import type { RenderPlaceholder } from '@/lib/album-builder/types';

/** Смысловые группы текстов обложки (порядок = порядок в модалке). */
export const COVER_TEXT_GROUPS = [
  'title',
  'name',
  'subtitle',
  'details',
  'spine',
  'contacts',
] as const;

export type CoverTextGroup = (typeof COVER_TEXT_GROUPS)[number];

/** Человекочитаемые названия групп для модалки. */
export const COVER_GROUP_LABELS: Record<CoverTextGroup, string> = {
  title: 'Заголовок',
  name: 'Имя выпускника',
  subtitle: 'Подзаголовок',
  details: 'Реквизиты (школа, город, год, класс)',
  spine: 'Текст на корешке',
  contacts: 'Контакты (задняя обложка)',
};

/** Какие метки обложки покрывает каждая группа (для подсказки в модалке). */
export const COVER_GROUP_HINTS: Record<CoverTextGroup, string> = {
  title: 'cover_title',
  name: 'cover_student_name',
  subtitle: 'cover_subtitle',
  details: 'cover_school_name + cover_city + cover_year + cover_class',
  spine: 'spine_text',
  contacts: 'back_contacts',
};

/**
 * Определяет группу стилей по метке обложки. Возвращает null если метка не
 * относится к настраиваемым текстам (тогда глобальный стиль её не трогает).
 */
export function detectCoverTextGroup(label: string): CoverTextGroup | null {
  switch (label.toLowerCase()) {
    case 'cover_title':
      return 'title';
    case 'cover_student_name':
      return 'name';
    case 'cover_subtitle':
      return 'subtitle';
    case 'cover_school_name':
    case 'cover_city':
    case 'cover_year':
    case 'cover_class':
      return 'details';
    case 'spine_text':
      return 'spine';
    case 'back_contacts':
      return 'contacts';
    default:
      return null;
  }
}

/** Значение колонки albums.cover_text_style_overrides. */
export type CoverTextStyleOverrides = {
  [K in CoverTextGroup]?: TextStyleGroupOverride | null;
};

/** Парсит JSONB из БД в типизированный объект (невалидное → {}). */
export function parseCoverTextStyleOverrides(raw: unknown): CoverTextStyleOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const result: CoverTextStyleOverrides = {};
  for (const group of COVER_TEXT_GROUPS) {
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
      typeof entry.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.color)
        ? entry.color.toUpperCase()
        : null;
    const halign = parseHAlign(entry.halign);
    const valign = parseVAlign(entry.valign);
    const fontFamily = parseFontFamily(entry.font_family);
    if (sizePct === null && color === null && halign === null && valign === null && fontFamily === null) {
      continue;
    }
    result[group] = { size_pct: sizePct, color, halign, valign, font_family: fontFamily };
  }
  return result;
}

/**
 * Накладывает глобальные стили обложки на data как НИЖНИЙ слой служебных
 * ключей: для каждого текст-плейсхолдера, чья группа настроена, добавляет
 * __fontSize__/__color__/__halign__/__valign__/__font__ ТОЛЬКО если такого
 * ключа ещё нет (точечная правка приоритетнее). Возвращает новый объект data.
 */
export function applyCoverTextStyles(
  data: Record<string, string | null>,
  placeholders: RenderPlaceholder[],
  overrides: CoverTextStyleOverrides | null | undefined,
): Record<string, string | null> {
  if (!overrides || Object.keys(overrides).length === 0) return data;
  const base: Record<string, string | null> = {};
  for (const ph of placeholders) {
    if (ph.type !== 'text') continue;
    const group = detectCoverTextGroup(ph.label);
    if (!group) continue;
    const ov = overrides[group];
    if (!ov) continue;
    const set = (key: string, val: string | null) => {
      // Точечная правка уже задана → не трогаем (она приоритетнее).
      if (key in data) return;
      base[key] = val;
    };
    if (ov.size_pct != null) set(`__fontSize__${ph.label}`, serializeFontSizeMult(ov.size_pct / 100));
    if (ov.color) set(`__color__${ph.label}`, ov.color);
    if (ov.halign) set(`__halign__${ph.label}`, ov.halign);
    if (ov.valign) set(`__valign__${ph.label}`, ov.valign);
    if (ov.font_family) set(`__font__${ph.label}`, ov.font_family);
  }
  // data (точечные правки + значения слотов) перекрывает базовый слой.
  return { ...base, ...data };
}
