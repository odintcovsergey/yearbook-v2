/**
 * @internal
 *
 * Shared утилиты для модулей внутри `lib/idml-converter/`.
 * Не предназначены для импорта снаружи этой папки —
 * публичный API парсера живёт в `parse.ts`.
 */

export const POINTS_PER_MM = 2.83464566929;

export function ptToMm(pt: number): number {
  return pt / POINTS_PER_MM;
}

export function num(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getAttr(
  obj: Record<string, unknown> | undefined,
  attr: string,
): string | undefined {
  if (!obj) return undefined;
  const v = obj['@_' + attr];
  return typeof v === 'string' ? v : undefined;
}

/** Рекурсивно ищет первый элемент с указанным тегом в распарсенном дереве. */
export function findFirst(
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

/** Собирает все элементы с указанным тегом на любой глубине. */
export function collectAll(
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

/**
 * Page/MasterSpread.GeometricBounds = "y1 x1 y2 x2" в pt.
 */
export function parseGeometricBounds(
  raw: string | undefined,
): { y1: number; x1: number; y2: number; x2: number } | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { y1: parts[0], x1: parts[1], y2: parts[2], x2: parts[3] };
}
