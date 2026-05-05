/**
 * Точка входа парсера IDML.
 *
 * Архитектурные решения и формат IDML —
 * см. docs/templates/idml-recon-notes.md, §6.
 *
 * Реализовано к коммиту 0.2.2:
 *   - распаковка IDML (zip) через jszip
 *   - чтение Resources/Preferences.xml (размеры страницы, FacingPages, PageBinding, bleed)
 *   - геометрия плейсхолдеров через `extract-geometry.ts`
 *     (leftmost-Page.ItemTransform, lowercase-нормализация label'ов,
 *     `_left`/`_right` суффиксы при коллизиях, rotation)
 *
 * В 0.3 — извлечение стилей текста (extract-styles.ts).
 */

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { computeSpreadGeometry, extractPlaceholders } from './extract-geometry';
import type {
  ParsedSpreadTemplate,
  ParsedTemplateSet,
  ParserWarning,
  SpreadTemplateType,
} from './types';
import { findFirst, getAttr, num, ptToMm } from './xml-utils';

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

// ─── MasterSpread ─────────────────────────────────────────────────────────

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

  const geometry = computeSpreadGeometry(masterSpread);
  if (!geometry) {
    warnings.push({
      message: 'Could not compute spread geometry (no valid pages)',
      master: name,
    });
    return null;
  }

  const placeholders = extractPlaceholders(
    masterSpread,
    geometry,
    name,
    warnings,
  );

  return {
    name,
    type: typeFromName(name),
    is_spread: geometry.is_spread,
    width_mm: geometry.width_mm,
    height_mm: geometry.height_mm,
    placeholders,
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
