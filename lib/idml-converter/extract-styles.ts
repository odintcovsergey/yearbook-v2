/**
 * Извлечение стилей текста из IDML.
 *
 * Разрешение происходит в три уровня:
 *   1. TextFrame.ParentStory → `Stories/Story_<id>.xml` →
 *      `AppliedParagraphStyle` + inline overrides на первом
 *      `<CharacterStyleRange>` (PointSize, FontStyle, FillColor).
 *   2. ParagraphStyle → `Resources/Styles.xml` → AppliedFont, PointSize,
 *      FontStyle, Justification, FillColor с **рекурсивным** разрешением
 *      `BasedOn`-цепочки (защита от циклов: max depth, кэш).
 *   3. FillColor → `Resources/Graphic.xml` → CMYK/RGB → hex.
 *
 * Контекст и решения — `docs/templates/idml-recon-notes.md` §6.7.
 */

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { ParserWarning, TextPlaceholder } from './types';
import { collectAll, findFirst, getAttr } from './xml-utils';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

/**
 * РЭ.56: отдельный парсер с preserveOrder=true для извлечения текстового
 * содержимого Story в правильном порядке.
 *
 * fast-xml-parser в обычном режиме (выше) группирует одноимённые теги в
 * массивы, теряя порядок между разными тегами. Для извлечения текста нам
 * нужен порядок Content vs Br чтобы правильно реконструировать строки —
 * поэтому делаем второй парс именно story XML.
 *
 * Не используется для стилей (там обычный xmlParser выше работает
 * корректно через findFirst/collectAll).
 */
const xmlParserPreserveOrder = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false, // важно — иначе пробелы в начале/конце Content съедятся
  preserveOrder: true,
});

const MAX_BASED_ON_DEPTH = 10;

// ─── Публичные типы ───────────────────────────────────────────────────────

type TextStyleProps = Pick<
  TextPlaceholder,
  | 'font_family'
  | 'font_size_pt'
  | 'font_weight'
  | 'color'
  | 'align'
  | 'vertical_align'
  | 'auto_fit'
  | 'min_size_pt'
>;

export type StyleResolver = {
  resolveTextStyle(
    storyId: string | null,
    label: string,
    masterName: string,
    warnings: ParserWarning[],
  ): TextStyleProps;
  /**
   * РЭ.56: возвращает текстовое содержимое story из IDML, если оно есть.
   * Используется парсером геометрии чтобы записать default_text в
   * TextPlaceholder. Декоративный текст из мастера («Дорогие выпускники!»)
   * через этот механизм попадает в БД и виден партнёру в редакторе как
   * редактируемое поле.
   *
   * Возвращает undefined для случаев когда:
   *   - storyId == null (фрейм без ParentStory — редко, но бывает)
   *   - story не найдена в IDML (попадание в эту ветку логируется
   *     отдельно в resolveTextStyle)
   *   - content пустой (нет ни одного <Content> в story, или все они
   *     пустые строки)
   */
  resolveTextContent(storyId: string | null): string | undefined;
};

// ─── Дефолты ──────────────────────────────────────────────────────────────

export const TEXT_STYLE_DEFAULTS: TextStyleProps = {
  font_family: 'Geologica',
  font_size_pt: 14,
  font_weight: 'regular',
  color: '#1a1a1a',
  align: 'left',
  vertical_align: 'top',
  auto_fit: false,
};

const FALLBACK_COLOR_HEX = '#1a1a1a';

// ─── Внутренние типы ──────────────────────────────────────────────────────

type ResolvedStyle = {
  pointSize?: number;
  fontStyle?: string;
  justification?: string;
  fillColor?: string;
  appliedFont?: string;
};

type RawParagraphStyle = ResolvedStyle & {
  id: string;
  basedOn: string | null;
};

type StoryEntry = {
  appliedParagraphStyle: string | null;
  inlinePointSize?: number;
  inlineFontStyle?: string;
  inlineFillColor?: string;
  paragraphStyleCount: number;
  /**
   * РЭ.56: содержимое текстового фрейма из IDML.
   *
   * Извлекается из всех <Content> элементов внутри Story в порядке
   * появления. Между Content-узлами разных абзацев (ParagraphStyleRange)
   * и через <Br/> вставляется '\n'. Это исходный текст который дизайнер
   * вписал в фрейм в InDesign — может быть placeholder'ом ('ФИО'),
   * декоративным текстом ('Дорогие выпускники!'), или ничем.
   *
   * Используется как default_text у TextPlaceholder. Чтобы декоративный
   * текст из IDML («Дорогие выпускники!» в S-Intro) попал в БД и был
   * виден партнёру в редакторе с возможностью править/удалять.
   */
  content?: string;
};

type ColorEntry = {
  space: 'CMYK' | 'RGB' | 'LAB' | 'OTHER';
  values: number[];
};

// ─── loadStyleResolver ────────────────────────────────────────────────────

export async function loadStyleResolver(zip: JSZip): Promise<StyleResolver> {
  const colors = await loadColors(zip);
  const styles = await loadParagraphStyles(zip);
  const stories = await loadStories(zip);
  const resolveCache = new Map<string, ResolvedStyle>();

  function resolveStyle(id: string, depth: number): ResolvedStyle {
    if (depth > MAX_BASED_ON_DEPTH) return {};
    const cached = resolveCache.get(id);
    if (cached) return cached;

    const raw = styles.get(id);
    if (!raw) return {};

    let parent: ResolvedStyle = {};
    if (raw.basedOn) {
      const parentId = normalizeBasedOnRef(raw.basedOn, styles);
      if (parentId) parent = resolveStyle(parentId, depth + 1);
    }

    const merged: ResolvedStyle = {
      pointSize: raw.pointSize ?? parent.pointSize,
      fontStyle: raw.fontStyle ?? parent.fontStyle,
      justification: raw.justification ?? parent.justification,
      fillColor: raw.fillColor ?? parent.fillColor,
      appliedFont: raw.appliedFont ?? parent.appliedFont,
    };
    resolveCache.set(id, merged);
    return merged;
  }

  return {
    resolveTextStyle(storyId, label, masterName, warnings): TextStyleProps {
      if (!storyId) return applyAutoFitRule(label, TEXT_STYLE_DEFAULTS);

      const story = stories.get(storyId);
      if (!story) {
        warnings.push({
          message: `Story not found for TextFrame.ParentStory=${storyId}`,
          master: masterName,
          label,
        });
        return applyAutoFitRule(label, TEXT_STYLE_DEFAULTS);
      }

      if (story.paragraphStyleCount > 1) {
        warnings.push({
          message:
            'Story has multiple paragraph styles, using first; consider simpler text frame',
          master: masterName,
          label,
        });
      }

      let resolved: ResolvedStyle = {};
      if (story.appliedParagraphStyle) {
        resolved = resolveStyle(story.appliedParagraphStyle, 0);
      }

      const pointSize = story.inlinePointSize ?? resolved.pointSize;
      const fontStyle = story.inlineFontStyle ?? resolved.fontStyle;
      const fillColor = story.inlineFillColor ?? resolved.fillColor;

      const props: TextStyleProps = {
        font_family: resolved.appliedFont ?? TEXT_STYLE_DEFAULTS.font_family,
        font_size_pt: pointSize ?? TEXT_STYLE_DEFAULTS.font_size_pt,
        font_weight: mapFontWeight(fontStyle),
        color: resolveColorToHex(fillColor, colors, masterName, label, warnings),
        align: mapJustification(resolved.justification),
        // TODO фаза 2+: vertical_align читать из TextFramePreference.FirstBaselineOffset.
        vertical_align: 'top',
        auto_fit: false, // override через applyAutoFitRule по правилу label
      };

      return applyAutoFitRule(label, props);
    },
    resolveTextContent(storyId): string | undefined {
      if (!storyId) return undefined;
      const story = stories.get(storyId);
      if (!story) return undefined;
      // content уже извлечено в loadStories с типографски чистой нормализацией.
      // Возвращаем undefined для пустых строк (важно — иначе попадёт '' в БД).
      return story.content && story.content.length > 0 ? story.content : undefined;
    },
  };
}

// ─── ParagraphStyles из Resources/Styles.xml ──────────────────────────────

async function loadParagraphStyles(
  zip: JSZip,
): Promise<Map<string, RawParagraphStyle>> {
  const out = new Map<string, RawParagraphStyle>();
  const file = zip.file('Resources/Styles.xml');
  if (!file) return out;

  const xml = await file.async('string');
  const root = xmlParser.parse(xml) as Record<string, unknown>;

  for (const style of collectAll(root, 'ParagraphStyle')) {
    const id = getAttr(style, 'Self');
    if (!id) continue;
    const props = findFirst(style, 'Properties');
    out.set(id, {
      id,
      basedOn: extractBasedOn(props),
      pointSize: parseNumberAttr(style, 'PointSize'),
      fontStyle: getAttr(style, 'FontStyle'),
      justification: getAttr(style, 'Justification'),
      fillColor: getAttr(style, 'FillColor'),
      appliedFont: extractTextChild(props, 'AppliedFont'),
    });
  }
  return out;
}

/**
 * BasedOn в IDML встречается в двух формах:
 *   - <BasedOn type="object">ParagraphStyle/...</BasedOn> — canonical Self
 *   - <BasedOn type="string">$ID/[No paragraph style]</BasedOn> — name (без префикса)
 * Возвращаем сырое значение, нормализация — в normalizeBasedOnRef.
 */
function extractBasedOn(props: Record<string, unknown> | null): string | null {
  return extractTextChild(props, 'BasedOn') ?? null;
}

function normalizeBasedOnRef(
  raw: string,
  styles: Map<string, RawParagraphStyle>,
): string | null {
  if (styles.has(raw)) return raw;
  const candidate = 'ParagraphStyle/' + raw;
  if (styles.has(candidate)) return candidate;
  return null;
}

function extractTextChild(
  props: Record<string, unknown> | null,
  tag: string,
): string | undefined {
  if (!props) return undefined;
  const el = findFirst(props, tag);
  if (!el) return undefined;
  const text = el['#text'];
  if (typeof text === 'string' && text.trim()) return text.trim();
  return undefined;
}

function parseNumberAttr(
  obj: Record<string, unknown>,
  attr: string,
): number | undefined {
  const v = getAttr(obj, attr);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ─── Stories из Stories/*.xml ─────────────────────────────────────────────

async function loadStories(zip: JSZip): Promise<Map<string, StoryEntry>> {
  const out = new Map<string, StoryEntry>();
  const paths = Object.keys(zip.files)
    .filter(
      (p) =>
        p.startsWith('Stories/') &&
        p.endsWith('.xml') &&
        !zip.files[p].dir,
    )
    .sort();

  for (const path of paths) {
    const xml = await zip.files[path].async('string');
    const root = xmlParser.parse(xml) as Record<string, unknown>;
    const story = findFirst(root, 'Story');
    if (!story) continue;
    const id = getAttr(story, 'Self');
    if (!id) continue;

    const paragraphRanges = collectAll(story, 'ParagraphStyleRange');

    // РЭ.56: текстовое содержимое — отдельный парс с preserveOrder=true.
    // См. комментарий к xmlParserPreserveOrder выше. Парсим тот же XML
    // ещё раз, извлекаем содержимое Story в порядке появления узлов
    // Content и Br. Это нужно чтобы декоративные тексты из IDML
    // («Дорогие выпускники!» в S-Intro и т.п.) попадали в БД как
    // default_text у placeholder'а.
    const contentText = extractStoryContent(xml);

    if (paragraphRanges.length === 0) {
      out.set(id, {
        appliedParagraphStyle: null,
        paragraphStyleCount: 0,
        content: contentText || undefined,
      });
      continue;
    }

    const firstParaRange = paragraphRanges[0];
    const characterRanges = collectAll(firstParaRange, 'CharacterStyleRange');
    const firstCharRange = characterRanges[0];

    out.set(id, {
      appliedParagraphStyle:
        getAttr(firstParaRange, 'AppliedParagraphStyle') ?? null,
      inlinePointSize: firstCharRange
        ? parseNumberAttr(firstCharRange, 'PointSize')
        : undefined,
      inlineFontStyle: firstCharRange
        ? getAttr(firstCharRange, 'FontStyle')
        : undefined,
      inlineFillColor: firstCharRange
        ? getAttr(firstCharRange, 'FillColor')
        : undefined,
      paragraphStyleCount: countDistinctParagraphStyles(paragraphRanges),
      content: contentText || undefined,
    });
  }
  return out;
}

/**
 * РЭ.56: извлечение текстового содержимого из Story XML.
 *
 * Парсит XML с preserveOrder=true и рекурсивно обходит все ноды,
 * собирая <Content> в строки и заменяя <Br/> на '\n'. Между
 * разными ParagraphStyleRange (абзацами) тоже вставляет '\n'.
 *
 * Возвращает финальную строку с типографски нормализованными
 * переводами строк. Если контент пуст — возвращает пустую строку.
 *
 * Не падает на отсутствие тегов — корректно отрабатывает все
 * варианты структуры story (пустой story, story без CharacterStyleRange,
 * story с одним Content, story с множеством абзацев).
 */
function extractStoryContent(xml: string): string {
  const parsed = xmlParserPreserveOrder.parse(xml) as unknown;
  if (!Array.isArray(parsed)) return '';

  // Найдём узел Story в массиве top-level узлов.
  let storyNode: unknown = null;
  for (const item of parsed) {
    if (item && typeof item === 'object' && 'Story' in (item as object)) {
      storyNode = (item as Record<string, unknown>).Story;
      break;
    }
  }
  if (!storyNode || !Array.isArray(storyNode)) return '';

  // Buffer накапливает строки; в конце склеиваем.
  const parts: string[] = [];

  function walk(nodes: unknown[]): void {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      // <Content>текст</Content> → { Content: [{ '#text': 'текст' }] }
      if ('Content' in obj && Array.isArray(obj.Content)) {
        for (const inner of obj.Content) {
          if (inner && typeof inner === 'object') {
            const t = (inner as Record<string, unknown>)['#text'];
            if (typeof t === 'string') parts.push(t);
          }
        }
        continue;
      }
      // <Br/> → { Br: [] } → перевод строки внутри абзаца.
      if ('Br' in obj) {
        parts.push('\n');
        continue;
      }
      // ParagraphStyleRange содержит CharacterStyleRange'ы.
      if ('ParagraphStyleRange' in obj && Array.isArray(obj.ParagraphStyleRange)) {
        if (parts.length > 0 && parts[parts.length - 1] !== '\n') {
          // Перевод строки между абзацами (если предыдущий контент уже не закончился на \n).
          parts.push('\n');
        }
        walk(obj.ParagraphStyleRange as unknown[]);
        continue;
      }
      // CharacterStyleRange содержит Content/Br.
      if ('CharacterStyleRange' in obj && Array.isArray(obj.CharacterStyleRange)) {
        walk(obj.CharacterStyleRange as unknown[]);
        continue;
      }
      // Любой другой контейнер (XMLElement, обёртка) — обходим рекурсивно
      // по всем массивам внутри (не теги типа #text, @_attribute).
      for (const key of Object.keys(obj)) {
        if (key === '#text' || key.startsWith('@_') || key === ':@') continue;
        const v = obj[key];
        if (Array.isArray(v)) walk(v);
      }
    }
  }

  walk(storyNode as unknown[]);

  // Финальная очистка: trim общий + сжатие нескольких подряд \n до одного.
  // Это убирает любые ложные пустые строки в начале/конце и между абзацами.
  const joined = parts.join('').replace(/\n{2,}/g, '\n').trim();
  return joined;
}

function countDistinctParagraphStyles(
  ranges: Array<Record<string, unknown>>,
): number {
  const seen = new Set<string>();
  for (const r of ranges) {
    const v = getAttr(r, 'AppliedParagraphStyle');
    if (v) seen.add(v);
  }
  return seen.size;
}

// ─── Colors из Resources/Graphic.xml ──────────────────────────────────────

async function loadColors(zip: JSZip): Promise<Map<string, ColorEntry>> {
  const out = new Map<string, ColorEntry>();
  const file = zip.file('Resources/Graphic.xml');
  if (!file) return out;

  const xml = await file.async('string');
  const root = xmlParser.parse(xml) as Record<string, unknown>;

  for (const c of collectAll(root, 'Color')) {
    const id = getAttr(c, 'Self');
    if (!id) continue;
    const spaceRaw = getAttr(c, 'Space') ?? 'OTHER';
    const space: ColorEntry['space'] =
      spaceRaw === 'CMYK' || spaceRaw === 'RGB' || spaceRaw === 'LAB'
        ? spaceRaw
        : 'OTHER';
    const valuesRaw = getAttr(c, 'ColorValue') ?? '';
    const values = valuesRaw
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    out.set(id, { space, values });
  }
  return out;
}

function resolveColorToHex(
  ref: string | undefined,
  colors: Map<string, ColorEntry>,
  masterName: string,
  label: string,
  warnings: ParserWarning[],
): string {
  if (!ref) return TEXT_STYLE_DEFAULTS.color;

  // Named cases (фаза 0).
  if (ref === 'Color/Black' || ref === 'Color/Registration') return '#000000';
  if (ref === 'Color/Paper') return '#ffffff';
  if (ref === 'Swatch/None') return TEXT_STYLE_DEFAULTS.color;

  const entry = colors.get(ref);
  if (!entry) {
    warnings.push({
      message: `Unknown color reference "${ref}", using fallback ${FALLBACK_COLOR_HEX}`,
      master: masterName,
      label,
    });
    return FALLBACK_COLOR_HEX;
  }

  if (entry.space === 'CMYK' && entry.values.length === 4) {
    return cmykToHex(
      entry.values[0],
      entry.values[1],
      entry.values[2],
      entry.values[3],
    );
  }
  if (entry.space === 'RGB' && entry.values.length === 3) {
    return rgbToHex(entry.values[0], entry.values[1], entry.values[2]);
  }

  warnings.push({
    message: `Color "${ref}" in unsupported space "${entry.space}", using fallback ${FALLBACK_COLOR_HEX}`,
    master: masterName,
    label,
  });
  return FALLBACK_COLOR_HEX;
}

/**
 * Стандартная формула CMYK→RGB без управления цветовым профилем.
 * Точная цветопередача — задача PDF-экспорта (фаза 3).
 */
function cmykToHex(c: number, m: number, y: number, k: number): string {
  const cc = clamp01(c / 100);
  const mm = clamp01(m / 100);
  const yy = clamp01(y / 100);
  const kk = clamp01(k / 100);
  const r = Math.round(255 * (1 - cc) * (1 - kk));
  const g = Math.round(255 * (1 - mm) * (1 - kk));
  const b = Math.round(255 * (1 - yy) * (1 - kk));
  return rgbToHex(r, g, b);
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + toHex2(r) + toHex2(g) + toHex2(b);
}

function toHex2(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  const h = v.toString(16);
  return h.length === 1 ? '0' + h : h;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Маппинги ─────────────────────────────────────────────────────────────

/**
 * IDML FontStyle → наши 4 значения font_weight.
 * Порядок проверок важен: medium-keywords перед "bold", чтобы "Semibold"
 * не попал в bold.
 *
 * TODO фаза 1+: расширить TextPlaceholder.font_weight на italic-варианты
 * (сейчас "Italic" игнорируется и попадает в "regular").
 */
function mapFontWeight(
  fontStyle: string | undefined,
): 'regular' | 'bold' | 'medium' | 'light' {
  if (!fontStyle) return 'regular';
  const s = fontStyle.toLowerCase();
  if (/semi[\s-]?bold|semibold|demi|medium/.test(s)) return 'medium';
  if (/light|thin|hairline/.test(s)) return 'light';
  if (/bold/.test(s)) return 'bold';
  return 'regular';
}

function mapJustification(
  j: string | undefined,
): 'left' | 'center' | 'right' | 'justify' {
  if (!j) return 'left';
  switch (j) {
    case 'CenterAlign':
      return 'center';
    case 'RightAlign':
      return 'right';
    case 'LeftJustified':
    case 'CenterJustified':
    case 'RightJustified':
    case 'FullyJustified':
      return 'justify';
    case 'LeftAlign':
    default:
      return 'left';
  }
}

function applyAutoFitRule(
  label: string,
  base: TextStyleProps,
): TextStyleProps {
  if (label.includes('name')) {
    return { ...base, auto_fit: true, min_size_pt: 12 };
  }
  if (label.includes('quote') || label.includes('role')) {
    return { ...base, auto_fit: false };
  }
  // TODO фаза 1+: рассмотреть применение auto_fit к другим label'ам
  // (например, headtextframe, description) если в продакшне будет обрезка
  // длинного текста.
  return base;
}
