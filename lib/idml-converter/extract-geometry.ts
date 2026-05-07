/**
 * Извлечение геометрии плейсхолдеров из MasterSpread XML.
 *
 * Правила парсера — `docs/templates/idml-recon-notes.md` §6.
 * Формула преобразования и эмпирическая проверка — recon-notes §3.
 */

import type { StyleResolver } from './extract-styles';
import type {
  BBox,
  ItemTransform,
  ParserWarning,
  Placeholder,
  Point,
  SpreadGeometry,
} from './types';
import {
  collectAll,
  findFirst,
  getAttr,
  parseGeometricBounds,
  ptToMm,
} from './xml-utils';

type FrameKind = 'rectangle' | 'oval' | 'textframe';

type FrameRecord = {
  node: Record<string, unknown>;
  kind: FrameKind;
};

// ─── computeSpreadGeometry ────────────────────────────────────────────────

/**
 * По всем `<Page>` внутри MasterSpread считает:
 *   - origin (= leftmost Page.ItemTransform.{tx, ty}, см. recon-notes §6.1),
 *   - размеры разворота в mm,
 *   - x-диапазоны страниц для последующего определения pageIndex фреймов.
 *
 * Возвращает null если pages нет — тогда parse.ts пишет warning и skip'ает мастер.
 */
export function computeSpreadGeometry(
  masterSpread: Record<string, unknown>,
): SpreadGeometry | null {
  const pages = collectAll(masterSpread, 'Page');
  if (pages.length === 0) return null;

  const pageInfos = pages
    .map((p) => {
      const t = parseItemTransform(getAttr(p, 'ItemTransform'));
      const b = parseGeometricBounds(getAttr(p, 'GeometricBounds'));
      if (!t || !b) return null;
      return {
        tx: t.tx,
        ty: t.ty,
        x_min: t.tx + b.x1,
        x_max: t.tx + b.x2,
        y_min: t.ty + b.y1,
        y_max: t.ty + b.y2,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (pageInfos.length === 0) return null;

  pageInfos.sort((a, b) => a.tx - b.tx);
  const leftmost = pageInfos[0];

  const spreadXMin = pageInfos.reduce((m, p) => Math.min(m, p.x_min), Infinity);
  const spreadXMax = pageInfos.reduce((m, p) => Math.max(m, p.x_max), -Infinity);
  const spreadYMin = pageInfos.reduce((m, p) => Math.min(m, p.y_min), Infinity);
  const spreadYMax = pageInfos.reduce((m, p) => Math.max(m, p.y_max), -Infinity);

  return {
    width_mm: ptToMm(spreadXMax - spreadXMin),
    height_mm: ptToMm(spreadYMax - spreadYMin),
    origin: { x: leftmost.tx, y: leftmost.ty },
    is_spread: pageInfos.length === 2,
    pages_x_ranges: pageInfos.map((p) => ({ x_min: p.x_min, x_max: p.x_max })),
  };
}

// ─── extractPlaceholders ──────────────────────────────────────────────────

export function extractPlaceholders(
  masterSpread: Record<string, unknown>,
  geometry: SpreadGeometry,
  masterName: string,
  warnings: ParserWarning[],
  resolver: StyleResolver,
): Placeholder[] {
  const frames = collectFrames(masterSpread);
  const result: Array<Placeholder & { _pageIndex: number }> = [];
  let unlabeledCount = 0;

  for (const frame of frames) {
    const originalLabel = extractLabel(frame.node);
    if (!originalLabel) {
      // Правило §6.2: фреймы без <KeyValuePair Key="Label"> пропускаем
      // как декоративные. Чтобы видеть это в S-Intro/S-Intro-Old и т.п. —
      // считаем количество и пишем ОДНУ агрегированную запись ниже.
      unlabeledCount++;
      continue;
    }

    const placeholder = frameToPlaceholder(
      frame,
      originalLabel,
      geometry,
      masterName,
      warnings,
      resolver,
    );
    if (placeholder) result.push(placeholder);
  }

  if (unlabeledCount > 0) {
    warnings.push({
      message: `${unlabeledCount} unlabeled frames skipped (decorative)`,
      master: masterName,
    });
  }

  dedupeLabels(result, masterName, warnings);
  return result.map(({ _pageIndex: _, ...rest }) => rest as Placeholder);
}

// ─── Сбор фреймов ─────────────────────────────────────────────────────────

function collectFrames(masterSpread: Record<string, unknown>): FrameRecord[] {
  const out: FrameRecord[] = [];
  for (const node of collectAll(masterSpread, 'Rectangle')) {
    out.push({ node, kind: 'rectangle' });
  }
  for (const node of collectAll(masterSpread, 'Oval')) {
    out.push({ node, kind: 'oval' });
  }
  for (const node of collectAll(masterSpread, 'TextFrame')) {
    out.push({ node, kind: 'textframe' });
  }
  return out;
}

// ─── Один фрейм → Placeholder ─────────────────────────────────────────────

function frameToPlaceholder(
  frame: FrameRecord,
  originalLabel: string,
  geometry: SpreadGeometry,
  masterName: string,
  warnings: ParserWarning[],
  resolver: StyleResolver,
): (Placeholder & { _pageIndex: number }) | null {
  const transform = parseItemTransform(getAttr(frame.node, 'ItemTransform'));
  if (!transform) {
    warnings.push({
      message: 'Frame skipped: missing or invalid ItemTransform',
      master: masterName,
      label: originalLabel,
    });
    return null;
  }

  const anchors = extractAnchorPoints(frame.node);
  if (anchors.length !== 4) {
    warnings.push({
      message: `Frame skipped in ${masterName}: expected 4 anchor points, got ${anchors.length}`,
      master: masterName,
      label: originalLabel,
    });
    return null;
  }

  const transformed = anchors.map((p) => applyTransform(transform, p));
  const bbox = boundingBox(transformed);

  const x_pt = bbox.x - geometry.origin.x;
  const y_pt = bbox.y - geometry.origin.y;
  const centroidX = bbox.x + bbox.width / 2;
  const pageIndex = pickPageIndex(centroidX, geometry.pages_x_ranges);

  const rotation = rotationDeg(transform);
  // Правило §6.4: lowercase-нормализация при импорте, оригинал в original_label.
  const label = originalLabel.toLowerCase();

  const common = {
    label,
    original_label: originalLabel,
    x_mm: ptToMm(x_pt),
    y_mm: ptToMm(y_pt),
    width_mm: ptToMm(bbox.width),
    height_mm: ptToMm(bbox.height),
    rotation_deg: rotation,
  };

  // required = false всегда — обязательность это продуктовая логика album-builder'а.
  if (frame.kind === 'rectangle') {
    return {
      ...common,
      type: 'photo',
      fit: 'fill_proportional',
      required: false,
      _pageIndex: pageIndex,
    };
  }

  if (frame.kind === 'oval') {
    return {
      ...common,
      type: 'photo',
      fit: 'fill_proportional',
      required: false,
      is_circle: true,
      _pageIndex: pageIndex,
    };
  }

  // textframe — стили резолвятся через StyleResolver
  // (Resources/Styles.xml + Stories/*.xml + Resources/Graphic.xml).
  // auto_fit правила по label применяются внутри resolveTextStyle.
  const parentStoryId = getAttr(frame.node, 'ParentStory') ?? null;
  const textStyle = resolver.resolveTextStyle(
    parentStoryId,
    label,
    masterName,
    warnings,
  );
  return {
    ...common,
    type: 'text',
    ...textStyle,
    _pageIndex: pageIndex,
  };
}

// ─── Дедупликация label'ов ────────────────────────────────────────────────

function dedupeLabels(
  placeholders: Array<Placeholder & { _pageIndex: number }>,
  masterName: string,
  warnings: ParserWarning[],
): void {
  // Группируем по label, в группах с >1 — добавляем суффиксы по pageIndex.
  const byLabel = new Map<
    string,
    Array<Placeholder & { _pageIndex: number }>
  >();
  for (const ph of placeholders) {
    const list = byLabel.get(ph.label);
    if (list) list.push(ph);
    else byLabel.set(ph.label, [ph]);
  }

  byLabel.forEach((group, label) => {
    if (group.length === 1) return;

    warnings.push({
      message: 'duplicate label, generated _left/_right suffixes',
      master: masterName,
      label,
    });

    for (const ph of group) {
      const suffix = ph._pageIndex === 0 ? '_left' : '_right';
      ph.label = `${label}${suffix}`;
    }
  });
}

// ─── Вспомогательные функции ──────────────────────────────────────────────

function pickPageIndex(
  centroidX: number,
  ranges: Array<{ x_min: number; x_max: number }>,
): number {
  if (ranges.length <= 1) return 0;
  for (let i = 0; i < ranges.length; i++) {
    if (centroidX >= ranges[i].x_min && centroidX <= ranges[i].x_max) {
      return i;
    }
  }
  // Centroid за пределами всех страниц — выбираем ближайшую по расстоянию до центра.
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ranges.length; i++) {
    const center = (ranges[i].x_min + ranges[i].x_max) / 2;
    const dist = Math.abs(centroidX - center);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function parseItemTransform(raw: string | undefined): ItemTransform | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return null;
  return {
    a: parts[0],
    b: parts[1],
    c: parts[2],
    d: parts[3],
    tx: parts[4],
    ty: parts[5],
  };
}

function parseAnchor(raw: string | undefined): Point | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1] };
}

function applyTransform(t: ItemTransform, p: Point): Point {
  return {
    x: t.a * p.x + t.c * p.y + t.tx,
    y: t.b * p.x + t.d * p.y + t.ty,
  };
}

function boundingBox(points: Point[]): BBox {
  const x_min = points.reduce((m, p) => Math.min(m, p.x), Infinity);
  const y_min = points.reduce((m, p) => Math.min(m, p.y), Infinity);
  const x_max = points.reduce((m, p) => Math.max(m, p.x), -Infinity);
  const y_max = points.reduce((m, p) => Math.max(m, p.y), -Infinity);
  return { x: x_min, y: y_min, width: x_max - x_min, height: y_max - y_min };
}

/** rotation_deg = atan2(b, a) * 180/π, нормализован к [-180, 180] (recon-notes §6.6). */
function rotationDeg(t: ItemTransform): number {
  const deg = (Math.atan2(t.b, t.a) * 180) / Math.PI;
  // atan2 уже даёт [-180, 180]; округляем до 4 знаков чтобы убрать FP-шум.
  return Math.round(deg * 10000) / 10000;
}

function extractLabel(frameNode: Record<string, unknown>): string | null {
  const props = findFirst(frameNode, 'Properties');
  if (!props) return null;
  const labelEl = findFirst(props, 'Label');
  if (!labelEl) return null;

  const kvps = toArray(labelEl['KeyValuePair']);
  for (const kvp of kvps) {
    if (getAttr(kvp, 'Key') === 'Label') {
      const value = getAttr(kvp, 'Value');
      if (value && value.trim()) return value.trim();
    }
  }
  return null;
}

function extractAnchorPoints(frameNode: Record<string, unknown>): Point[] {
  const props = findFirst(frameNode, 'Properties');
  if (!props) return [];
  const pathGeometry = findFirst(props, 'PathGeometry');
  if (!pathGeometry) return [];
  const geomPathType = findFirst(pathGeometry, 'GeometryPathType');
  if (!geomPathType) return [];
  const pathPointArray = findFirst(geomPathType, 'PathPointArray');
  if (!pathPointArray) return [];

  const pointTypes = toArray(pathPointArray['PathPointType']);
  const out: Point[] = [];
  for (const pt of pointTypes) {
    const p = parseAnchor(getAttr(pt, 'Anchor'));
    if (p) out.push(p);
  }
  return out;
}

function toArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object') {
    return [value as Record<string, unknown>];
  }
  return [];
}
