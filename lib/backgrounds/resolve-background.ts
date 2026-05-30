/**
 * Система категорийных фонов — Этап 2: резолвер фона на разворот.
 *
 * Чистая функция. На вход — список ВИЗУАЛЬНЫХ разворотов (уже сгруппированных
 * через segmentToSpreads) + пул фонов набора + default-фон как fallback.
 * На выход — url фона для каждого разворота (или null = без фона).
 *
 * === Три уровня приоритета (сверху вниз) ===
 *   1. album override  — партнёр сменил фон вручную в редакторе (__bg__ в data);
 *   2. master override  — background_override_url ведущего мастера;
 *   3. ротация категории — пул template_set_backgrounds, по кругу;
 *   → fallback: default_background_url; → иначе null.
 *
 * === Категория разворота ===
 * Определяется по ВЕДУЩЕЙ странице: левая; если левой нет (форзац soft) —
 * правая. Эту резолюцию делает вызывающий код и передаёт leadingPageRole.
 * Пример смешанного разворота: слева хвост портретов (student_last), справа
 * начало общего раздела (common) → ведущая левая → категория `student`.
 *
 * === Ротация ===
 *   - По кругу: pool[index % count].
 *   - Счётчик сбрасывается на смене section_type (каждый раздел крутит свою
 *     ротацию заново, начиная с фон[0]).
 *   - index = порядковый номер разворота ВНУТРИ раздела (по разворотам, не по
 *     страницам — обе половины разворота берут одну картинку).
 *   - Счётчик растёт на КАЖДОМ развороте раздела, даже если на конкретном
 *     развороте сработал override — «номер разворота внутри раздела» стабилен.
 *   - Если в категории 0 фонов → fallback на default_background_url, иначе null.
 */

import { pageRoleToCategory } from './page-role-to-category';
import type { PageRole } from '@/lib/album-builder/types';

/** Один разворот на входе резолвера. */
export type SpreadBackgroundInput = {
  /** page_role ведущей страницы (левой, иначе правой). */
  leadingPageRole: PageRole | null | undefined;
  /** section_type ведущей страницы — якорь сброса ротации. */
  sectionType: string | null | undefined;
  /** master override ведущего мастера (spread_templates.background_override_url). */
  masterOverrideUrl?: string | null;
  /** album override этого разворота (ключ __bg__ в data). */
  albumOverrideUrl?: string | null;
};

/** Строка пула фонов (проекция template_set_backgrounds). */
export type BackgroundPoolRow = {
  category: string;
  url: string;
  sort_order: number;
};

/**
 * Группирует пул по категориям и сортирует каждую по sort_order (стабильно).
 * Возвращает Map<category, url[]> — готовые кольца ротации.
 */
function buildRotationRings(
  pool: readonly BackgroundPoolRow[],
): Map<string, string[]> {
  const byCategory = new Map<string, BackgroundPoolRow[]>();
  for (const row of pool) {
    const list = byCategory.get(row.category);
    if (list) list.push(row);
    else byCategory.set(row.category, [row]);
  }

  const rings = new Map<string, string[]>();
  byCategory.forEach((rows, category) => {
    // Стабильная сортировка по sort_order; при равенстве сохраняем порядок
    // прихода (Array.prototype.sort в V8 стабилен).
    const urls = [...rows].sort((a, b) => a.sort_order - b.sort_order).map((r) => r.url);
    rings.set(category, urls);
  });
  return rings;
}

/**
 * Резолвит фон для каждого разворота.
 *
 * @param spreads  визуальные развороты в порядке альбома
 * @param pool     все фоны template_set (template_set_backgrounds)
 * @param defaultBackgroundUrl  fallback (template_sets.default_background_url)
 * @returns массив url|null, по одному на разворот (тот же порядок и длина)
 */
export function resolveBackgrounds(
  spreads: readonly SpreadBackgroundInput[],
  pool: readonly BackgroundPoolRow[],
  defaultBackgroundUrl?: string | null,
): (string | null)[] {
  const rings = buildRotationRings(pool);
  const fallback = defaultBackgroundUrl ?? null;

  const result: (string | null)[] = [];

  // Якорь сброса ротации. section_type сам может быть undefined (старые
  // альбомы) — тогда все такие развороты считаются одним непрерывным
  // разделом, что для legacy ожидаемо. Флаг first гарантирует, что первый
  // разворот всегда стартует с индекса 0.
  let prevSection: string | null | undefined;
  let first = true;
  let indexInSection = 0;

  for (const spread of spreads) {
    // Смена раздела → сброс счётчика разворотов.
    if (first || spread.sectionType !== prevSection) {
      prevSection = spread.sectionType;
      indexInSection = 0;
      first = false;
    }

    let url: string | null;

    // 1. Album override — высший приоритет.
    if (spread.albumOverrideUrl) {
      url = spread.albumOverrideUrl;
    }
    // 2. Master override.
    else if (spread.masterOverrideUrl) {
      url = spread.masterOverrideUrl;
    }
    // 3. Ротация по категории → fallback default → null.
    else {
      const category = pageRoleToCategory(spread.leadingPageRole);
      const ring = category ? rings.get(category) : undefined;
      if (ring && ring.length > 0) {
        url = ring[indexInSection % ring.length];
      } else {
        url = fallback;
      }
    }

    result.push(url);
    // Счётчик растёт на каждом развороте раздела (стабильный «номер разворота»).
    indexInSection += 1;
  }

  return result;
}
