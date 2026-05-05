/**
 * Точка входа парсера IDML.
 *
 * Архитектурные решения и формат IDML —
 * см. docs/templates/idml-recon-notes.md, §6.
 *
 * В коммите 0.2.1 реализованы:
 *   - распаковка IDML (zip) через jszip
 *   - чтение Resources/Preferences.xml (размеры страницы, FacingPages, PageBinding, bleed)
 *   - скелет цикла по MasterSpreads/*.xml (placeholders = [] для каждого мастера)
 *
 * В 0.2.2 добавится извлечение геометрии плейсхолдеров (extract-geometry.ts).
 * В 0.3 — извлечение стилей текста (extract-styles.ts).
 */

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type {
  ParsedSpreadTemplate,
  ParsedTemplateSet,
  ParserWarning,
  SpreadTemplateType,
} from './types';

const POINTS_PER_MM = 2.83464566929;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

export async function parseIdml(
  input: Uint8Array | Buffer,
): Promise<ParsedTemplateSet> {
  const warnings: ParserWarning[] = [];

  const zip = await JSZip.loadAsync(input);

  const preferences = await readPreferences(zip);

  const spread_templates: ParsedSpreadTemplate[] = [];
  const masterSpreadFiles = Object.keys(zip.files)
    .filter(
      (path) =>
        path.startsWith('MasterSpreads/') &&
        path.endsWith('.xml') &&
        !zip.files[path].dir,
    )
    .sort();

  for (const path of masterSpreadFiles) {
    const xml = await zip.files[path].async('string');
    const parsed = parseMasterSpread(xml, path, warnings);
    if (parsed) spread_templates.push(parsed);
  }

  return {
    ...preferences,
    spread_templates,
    warnings,
  };
}

// ─── Preferences ──────────────────────────────────────────────────────────

async function readPreferences(zip: JSZip): Promise<
  Pick<
    ParsedTemplateSet,
    | 'page_width_mm'
    | 'page_height_mm'
    | 'spread_width_mm'
    | 'spread_height_mm'
    | 'bleed_mm'
    | 'facing_pages'
    | 'page_binding'
  >
> {
  const path = 'Resources/Preferences.xml';
  const file = zip.file(path);
  if (!file) {
    throw new Error(`IDML: missing ${path}`);
  }
  const xml = await file.async('string');
  const root = xmlParser.parse(xml) as Record<string, unknown>;

  const docPref = findFirst(root, 'DocumentPreference');
  if (!docPref) {
    throw new Error(`IDML: DocumentPreference not found in ${path}`);
  }

  const pageWidthPt = num(getAttr(docPref, 'PageWidth'), 0);
  const pageHeightPt = num(getAttr(docPref, 'PageHeight'), 0);
  const facingPages = getAttr(docPref, 'FacingPages') === 'true';
  const pageBindingRaw = getAttr(docPref, 'PageBinding');
  const page_binding: 'LeftToRight' | 'RightToLeft' =
    pageBindingRaw === 'RightToLeft' ? 'RightToLeft' : 'LeftToRight';

  const bleedPt = Math.max(
    num(getAttr(docPref, 'DocumentBleedTopOffset'), 0),
    num(getAttr(docPref, 'DocumentBleedBottomOffset'), 0),
    num(getAttr(docPref, 'DocumentBleedInsideOrLeftOffset'), 0),
    num(getAttr(docPref, 'DocumentBleedOutsideOrRightOffset'), 0),
  );

  const page_width_mm = ptToMm(pageWidthPt);
  const page_height_mm = ptToMm(pageHeightPt);
  const spread_width_mm = facingPages ? page_width_mm * 2 : page_width_mm;
  const spread_height_mm = page_height_mm;

  return {
    page_width_mm,
    page_height_mm,
    spread_width_mm,
    spread_height_mm,
    bleed_mm: ptToMm(bleedPt),
    facing_pages: facingPages,
    page_binding,
  };
}

// ─── MasterSpread (скелет, наполнение в 0.2.2) ────────────────────────────

function parseMasterSpread(
  xml: string,
  path: string,
  warnings: ParserWarning[],
): ParsedSpreadTemplate | null {
  const root = xmlParser.parse(xml) as Record<string, unknown>;
  const masterSpread = findFirst(root, 'MasterSpread');
  if (!masterSpread) {
    warnings.push({ message: `MasterSpread element not found in ${path}` });
    return null;
  }

  const name = (getAttr(masterSpread, 'Name') ?? '').trim();
  if (!name) {
    warnings.push({ message: `MasterSpread without Name in ${path}` });
    return null;
  }

  const pages = collectAll(masterSpread, 'Page');
  const is_spread = pages.length === 2;

  const { width_mm, height_mm } = pageBoundsToMm(pages);

  return {
    name,
    type: typeFromName(name),
    is_spread,
    width_mm,
    height_mm,
    // Геометрия плейсхолдеров — в 0.2.2 (extract-geometry.ts).
    placeholders: [],
    rules: null,
  };
}

function typeFromName(name: string): SpreadTemplateType {
  const prefix = name.charAt(0).toUpperCase();
  switch (prefix) {
    case 'E':
    case 'D':
    case 'L':
    case 'N':
      return 'student';
    case 'F':
      return 'head_teacher';
    case 'G':
      return 'subjects';
    case 'J':
      return 'common';
    case 'S':
      return 'intro';
    default:
      return 'common';
  }
}

/**
 * Размер мастер-страницы (или разворота) в mm — на базе GeometricBounds первой страницы.
 * GeometricBounds = "y1 x1 y2 x2" в pt.
 *
 * В 0.2.2 эта функция станет частью общей логики leftmost-Page.ItemTransform.
 * Здесь — упрощённая версия: для двухстраничных берём 2× ширину одной страницы.
 */
function pageBoundsToMm(pages: Record<string, unknown>[]): {
  width_mm: number;
  height_mm: number;
} {
  if (pages.length === 0) return { width_mm: 0, height_mm: 0 };

  const bounds = parseGeometricBounds(getAttr(pages[0], 'GeometricBounds'));
  if (!bounds) return { width_mm: 0, height_mm: 0 };

  const singleWidthMm = ptToMm(bounds.x2 - bounds.x1);
  const heightMm = ptToMm(bounds.y2 - bounds.y1);

  return {
    width_mm: pages.length === 2 ? singleWidthMm * 2 : singleWidthMm,
    height_mm: heightMm,
  };
}

function parseGeometricBounds(
  raw: string | undefined,
): { y1: number; x1: number; y2: number; x2: number } | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { y1: parts[0], x1: parts[1], y2: parts[2], x2: parts[3] };
}

// ─── Утилиты обхода XML ───────────────────────────────────────────────────

/**
 * Рекурсивно ищет первый элемент с указанным тегом в распарсенном дереве.
 */
function findFirst(
  node: unknown,
  tag: string,
): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (tag in obj) {
    const value = obj[tag];
    if (Array.isArray(value)) {
      return (value[0] as Record<string, unknown>) ?? null;
    }
    if (value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const found = findFirst(obj[key], tag);
    if (found) return found;
  }
  return null;
}

/**
 * Собирает все элементы с указанным тегом на любой глубине.
 */
function collectAll(
  node: unknown,
  tag: string,
  out: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return out;
  const obj = node as Record<string, unknown>;
  if (tag in obj) {
    const value = obj[tag];
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v && typeof v === 'object') {
          out.push(v as Record<string, unknown>);
        }
      }
    } else if (value && typeof value === 'object') {
      out.push(value as Record<string, unknown>);
    }
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const v = obj[key];
    if (v && typeof v === 'object') collectAll(v, tag, out);
  }
  return out;
}

function getAttr(
  obj: Record<string, unknown> | undefined,
  attr: string,
): string | undefined {
  if (!obj) return undefined;
  const v = obj['@_' + attr];
  return typeof v === 'string' ? v : undefined;
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ptToMm(pt: number): number {
  return pt / POINTS_PER_MM;
}
