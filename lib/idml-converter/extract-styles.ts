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
  // Часть 3 ТЗ (Путь А): обводка текста читается из штатного Stroke InDesign
  // (StrokeColor + StrokeWeight на CharacterStyleRange / ParagraphStyle).
  | 'text_stroke_color'
  | 'text_stroke_width_pt'
>;

export type StyleResolver = {
  resolveTextStyle(
    storyId: string | null,
    label: string,
    masterName: string,
    warnings: ParserWarning[],
  ): TextStyleProps;
  /**
   * Часть 3 ТЗ (Путь А): резолвит ссылку на цвет IDML (`Color/...`) в hex.
   * Используется парсером геометрии для цвета свечения текста (OuterGlow
   * EffectColor), который живёт на фрейме, а не в story. Возвращает null
   * для отсутствующих / «никаких» цветов (`Swatch/None`, `n`, пусто) и
   * неизвестных ссылок — вызывающий подставляет дефолт.
   */
  resolveColorRef(ref: string | undefined): string | null;
  /**
   * Часть 2 ТЗ: внешнее свечение фото-фрейма из СТИЛЯ ОБЪЕКТА
   * (AppliedObjectStyle), а не с самого фрейма. Дизайнерские наборы (напр.
   * «Аква меч») задают Outer Glow рамок через ObjectStyle с цепочкой BasedOn,
   * причём Size часто не указан в стиле — наследуется от документного дефолта
   * (Preferences, обычно 7pt), а цвет берётся из EffectColor стиля.
   *
   * Возвращает { glow_size_pt, glow_color } если свечение включено (Applied),
   * либо null. Размер всегда > 0 (подставляется дефолт). Цвет может быть null
   * (тогда upload подставит доминирующий цвет привязанного декора).
   */
  resolveObjectGlow(
    objectStyleId: string | undefined,
  ): { glow_size_pt: number; glow_color: string | null } | null;
  /** Документный дефолт размера Outer Glow (pt) — для прямого glow без Size. */
  readonly defaultGlowSizePt: number;
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
  // Часть 3 ТЗ (Путь А): обводка текста на уровне стиля абзаца.
  strokeColor?: string;
  strokeWeight?: number;
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
  /**
   * Inline-переопределение выключки на ПЕРВОМ ParagraphStyleRange. В IDML
   * выключка живёт на абзаце (ParagraphStyleRange.Justification), а не на
   * символьном диапазоне. Дизайнер часто применяет стиль абзаца с justify, но
   * локально переопределяет на CenterAlign — это переопределение и есть то,
   * что InDesign рисует. Должно побеждать justification стиля.
   */
  inlineJustification?: string;
  // Часть 3 ТЗ (Путь А): обводка текста — inline-оверрайд на первом
  // CharacterStyleRange (StrokeColor — ссылка на цвет, StrokeWeight — pt).
  inlineStrokeColor?: string;
  inlineStrokeWeight?: number;
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
  const objectStyles = await loadObjectStyles(zip);
  const defaultGlowSizePt = await loadDefaultGlowSize(zip);
  const stories = await loadStories(zip);
  const resolveCache = new Map<string, ResolvedStyle>();

  // Резолв свечения по цепочке BasedOn стиля объекта. applied берётся у самого
  // близкого стиля, где OuterGlowSetting задан явно; size/colorRef — первое
  // определённое вниз по цепочке.
  function resolveObjectGlowRaw(
    id: string,
    depth: number,
  ): { applied: boolean; size?: number; colorRef?: string } {
    if (depth > MAX_BASED_ON_DEPTH) return { applied: false };
    const raw = objectStyles.get(id);
    if (!raw) return { applied: false };
    const hasOwn = raw.glowApplied !== undefined;
    let applied = hasOwn ? raw.glowApplied === true : false;
    let size = raw.glowSize;
    let colorRef = isRealColorRef(raw.glowColorRef) ? raw.glowColorRef : undefined;
    if (raw.basedOn) {
      const pid = normalizeObjectStyleRef(raw.basedOn, objectStyles);
      if (pid) {
        const parent = resolveObjectGlowRaw(pid, depth + 1);
        if (!hasOwn) applied = parent.applied;
        if (size === undefined) size = parent.size;
        if (colorRef === undefined) colorRef = parent.colorRef;
      }
    }
    return { applied, size, colorRef };
  }

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
      strokeColor: raw.strokeColor ?? parent.strokeColor,
      strokeWeight: raw.strokeWeight ?? parent.strokeWeight,
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
        // inline-override выключки на абзаце побеждает стиль (см. StoryEntry).
        align: mapJustification(story.inlineJustification ?? resolved.justification),
        // vertical_align перекрывается в extract-geometry (extractVerticalAlign
        // читает VerticalJustification фрейма); здесь — дефолт.
        vertical_align: 'top',
        auto_fit: false, // override через applyAutoFitRule по правилу label
      };

      // Часть 3 ТЗ (Путь А): обводка букв из штатного Stroke InDesign.
      // Обводка «включена» только если задан реальный цвет обводки
      // (StrokeColor ≠ Swatch/None) И положительная толщина. У КАЖДОГО
      // CharacterStyleRange всегда есть дефолтный StrokeWeight (~0.4pt),
      // поэтому ориентируемся именно на наличие цвета, а не толщины.
      const strokeColorRef = story.inlineStrokeColor ?? resolved.strokeColor;
      const strokeWeight = story.inlineStrokeWeight ?? resolved.strokeWeight;
      if (
        isRealColorRef(strokeColorRef) &&
        strokeWeight !== undefined &&
        strokeWeight > 0
      ) {
        props.text_stroke_color = resolveColorToHex(
          strokeColorRef,
          colors,
          masterName,
          label,
          warnings,
        );
        props.text_stroke_width_pt = strokeWeight;
      }

      return applyAutoFitRule(label, props);
    },
    resolveColorRef(ref): string | null {
      return resolveColorRefOrNull(ref, colors);
    },
    defaultGlowSizePt,
    resolveObjectGlow(objectStyleId) {
      const id = normalizeObjectStyleRef(objectStyleId, objectStyles);
      if (!id) return null;
      const g = resolveObjectGlowRaw(id, 0);
      if (!g.applied) return null;
      const size = g.size !== undefined && g.size > 0 ? g.size : defaultGlowSizePt;
      return {
        glow_size_pt: size,
        glow_color: resolveColorRefOrNull(g.colorRef, colors),
      };
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
      strokeColor: getAttr(style, 'StrokeColor'),
      strokeWeight: parseNumberAttr(style, 'StrokeWeight'),
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

// ─── ObjectStyles (свечение фото-фреймов, Часть 2 ТЗ) ──────────────────────

type RawObjectStyle = {
  id: string;
  basedOn: string | null;
  /** undefined = у стиля нет своего OuterGlowSetting (наследуется от BasedOn). */
  glowApplied?: boolean;
  glowSize?: number;
  glowColorRef?: string;
};

async function loadObjectStyles(
  zip: JSZip,
): Promise<Map<string, RawObjectStyle>> {
  const out = new Map<string, RawObjectStyle>();
  const file = zip.file('Resources/Styles.xml');
  if (!file) return out;
  const root = xmlParser.parse(await file.async('string')) as Record<string, unknown>;

  for (const style of collectAll(root, 'ObjectStyle')) {
    const id = getAttr(style, 'Self');
    if (!id) continue;
    const props = findFirst(style, 'Properties');
    const glow = findFirst(style, 'OuterGlowSetting');
    let glowApplied: boolean | undefined;
    let glowSize: number | undefined;
    let glowColorRef: string | undefined;
    if (glow) {
      glowApplied = getAttr(glow, 'Applied') !== 'false';
      glowSize = parseNumberAttr(glow, 'Size');
      glowColorRef = getAttr(glow, 'EffectColor');
    }
    out.set(id, {
      id,
      basedOn: extractBasedOn(props),
      glowApplied,
      glowSize,
      glowColorRef,
    });
  }
  return out;
}

function normalizeObjectStyleRef(
  raw: string | undefined,
  styles: Map<string, RawObjectStyle>,
): string | null {
  if (!raw) return null;
  if (styles.has(raw)) return raw;
  const candidate = 'ObjectStyle/' + raw;
  if (styles.has(candidate)) return candidate;
  return null;
}

/**
 * Документный дефолт размера Outer Glow (pt). InDesign не пишет Size в
 * ObjectStyle, если он равен дефолтному — берём дефолт из Preferences
 * (TransparencyDefaultRenderingSetting). Fallback 7pt (стандарт InDesign).
 */
async function loadDefaultGlowSize(zip: JSZip): Promise<number> {
  const file = zip.file('Resources/Preferences.xml');
  if (!file) return 7;
  const root = xmlParser.parse(await file.async('string')) as Record<string, unknown>;
  const glow = findFirst(root, 'OuterGlowSetting');
  const s = glow ? parseNumberAttr(glow, 'Size') : undefined;
  return s !== undefined && s > 0 ? s : 7;
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
      inlineJustification: getAttr(firstParaRange, 'Justification'),
      inlinePointSize: firstCharRange
        ? parseNumberAttr(firstCharRange, 'PointSize')
        : undefined,
      inlineFontStyle: firstCharRange
        ? getAttr(firstCharRange, 'FontStyle')
        : undefined,
      inlineFillColor: firstCharRange
        ? getAttr(firstCharRange, 'FillColor')
        : undefined,
      inlineStrokeColor: firstCharRange
        ? getAttr(firstCharRange, 'StrokeColor')
        : undefined,
      inlineStrokeWeight: firstCharRange
        ? parseNumberAttr(firstCharRange, 'StrokeWeight')
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

  // РЭ.56.1 фикс: ищем узел Story РЕКУРСИВНО, не только на верхнем уровне.
  // В реальных IDML файлах Story обёрнут в idPkg:Story (namespace prefix
  // из IDML packaging spec), поэтому верхнеуровневый ключ — 'idPkg:Story',
  // а 'Story' лежит внутри. Раньше парсер не находил Story и возвращал
  // пустую строку — default_text не записывался в БД.
  //
  // Рекурсивный поиск устойчив к любой обёртке: возвращает array узлов
  // первого встреченного 'Story' тега на любой глубине.
  function findStoryArray(nodes: unknown[]): unknown[] | null {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      // Прямое попадание: { Story: [...] }
      if ('Story' in obj && Array.isArray(obj.Story)) {
        return obj.Story as unknown[];
      }
      // Иначе рекурсивно по всем дочерним массивам (idPkg:Story → внутри).
      for (const key of Object.keys(obj)) {
        if (key === '#text' || key.startsWith('@_') || key === ':@') continue;
        const v = obj[key];
        if (Array.isArray(v)) {
          const found = findStoryArray(v);
          if (found) return found;
        }
      }
    }
    return null;
  }

  const storyNode = findStoryArray(parsed);
  if (!storyNode) return '';

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

  walk(storyNode);

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

/**
 * Часть 3 ТЗ (Путь А): «реальна» ли ссылка на цвет — т.е. задан настоящий
 * цвет, а не «никакой». IDML пишет «нет цвета» как `Swatch/None`, `n` или
 * вовсе опускает атрибут. Нужна для обводки: дефолтная StrokeWeight есть
 * у каждого ранжа, поэтому факт обводки определяем по цвету.
 */
function isRealColorRef(ref: string | undefined): boolean {
  return (
    !!ref && ref !== 'Swatch/None' && ref !== 'Color/None' && ref !== 'n'
  );
}

/**
 * Часть 3 ТЗ (Путь А): резолвит ссылку на цвет в hex, либо null если цвета
 * нет / он неизвестен. В отличие от resolveColorToHex не пишет warning и не
 * подставляет fallback — для декоративного свечения отсутствие цвета это
 * норма (вызывающий ставит дефолт).
 */
function resolveColorRefOrNull(
  ref: string | undefined,
  colors: Map<string, ColorEntry>,
): string | null {
  if (!isRealColorRef(ref)) return null;
  if (ref === 'Color/Black' || ref === 'Color/Registration') return '#000000';
  if (ref === 'Color/Paper') return '#ffffff';
  const entry = colors.get(ref!);
  if (!entry) return null;
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
  return null;
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
