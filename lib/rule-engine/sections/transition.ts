/**
 * Заполнение секции type='transition' для buildFromSectionStructure.
 *
 * РЭ.32 — переписано. Правая страница переходного разворота когда
 * personal section закончился на левой (pageInstances.length нечётный).
 *
 * Алгоритм:
 *   1. Если pageInstances.length чётный → секция не нужна, выход.
 *   2. Если master_name задан партнёром в шаблоне → используем его.
 *      Если в template_set этого мастера нет — warning + fallback на
 *      встроенное правило.
 *   3. Если master_name null/undefined → встроенное правило по умолчанию.
 *
 * Встроенное правило по умолчанию (РЭ.32 пока): жадно ищем подходящий
 * J-мастер в template_set:
 *   - full_class: 1 фото → берём первый чистый мастер с classphotoframe
 *   - half_class: 2 фото → первый с halfphoto_1/2
 *   - quarter: 4 фото → первый с quarterphoto_1..4
 *   - sixth: 6 фото → первый с collagephoto_1..6
 * Чистый мастер = только J-категория, без studentportrait/teacherphoto.
 * Берём первую категорию по приоритету full → half → quarter → sixth
 * у которой одновременно (а) хватает фото и (б) есть подходящий мастер.
 *
 * Если ни одна категория не подходит → warning transition_skipped, секция
 * пропускается, правая страница остаётся пустой.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { CommonPhotoCounts, SlotConsumes } from '../slot-chains';
import { bindCommonPhotos, decrementAvailable } from './common';
import type { SectionFillContext } from './shared';

type Category = 'full_class' | 'half_class' | 'quarter' | 'sixth';

const PHOTO_COUNT: Record<Category, number> = {
  full_class: 1,
  half_class: 2,
  quarter: 4,
  sixth: 6,
};

const PRIORITY: Category[] = ['full_class', 'half_class', 'quarter', 'sixth'];

/**
 * Анализирует placeholders мастера и возвращает категории которые он
 * умеет принять. Маппинг тот же что в common-required.ts:
 *   classphotoframe → full_class
 *   halfphoto_N (>=2) → half_class
 *   quarterphoto_N (>=4) → quarter
 *   collagephoto_N (6) → sixth
 *   collagephoto_N (4) → quarter (мастер J-Collage-4)
 * studentportrait_N / teacherphoto_N → не J-мастер, возвращаем null.
 */
function classifyMasterCategory(master: SpreadTemplate): Category | null {
  let halfCount = 0;
  let quarterCount = 0;
  let collageCount = 0;
  let hasFull = false;
  for (const ph of master.placeholders ?? []) {
    const label = ph.label.toLowerCase();
    if (
      label.match(/^studentportrait_\d+$/) ||
      label.match(/^teacherphoto_\d+$/) ||
      label === 'headteacherphoto'
    ) {
      return null; // не J-мастер
    }
    if (label === 'classphotoframe') hasFull = true;
    else if (label.match(/^halfphoto_\d+$/)) halfCount++;
    else if (label.match(/^quarterphoto_\d+$/)) quarterCount++;
    else if (label.match(/^collagephoto_\d+$/)) collageCount++;
  }
  if (collageCount === 6) return 'sixth';
  if (collageCount === 4) return 'quarter';
  if (quarterCount >= 4) return 'quarter';
  if (halfCount >= 2) return 'half_class';
  if (hasFull) return 'full_class';
  return null;
}

/**
 * Найти первый чистый J-мастер для заданной категории. Если category
 * = quarter и в template_set есть J-Quarter-Right — на позиции right
 * берём его (зеркало).
 */
function findCommonMasterForCategory(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  category: Category,
  position: 'left' | 'right',
): SpreadTemplate | null {
  for (const m of Array.from(mastersByName.values())) {
    if (m.name.endsWith('-Right')) continue; // зеркальные находим через base
    const cat = classifyMasterCategory(m);
    if (cat !== category) continue;
    if (position === 'right') {
      // Пробуем -Right вариант.
      if (m.name.endsWith('-Left')) {
        const right = mastersByName.get(m.name.replace(/-Left$/, '-Right'));
        if (right) return right;
      }
      const rightAlt = mastersByName.get(m.name + '-Right');
      if (rightAlt) return rightAlt;
    }
    return m;
  }
  return null;
}

/**
 * Главная функция секции.
 */
export function fillTransitionSection(
  ctx: SectionFillContext,
  masterName: string | null | undefined,
): void {
  // 1. Чётность.
  if (ctx.pageInstances.length % 2 === 0) {
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2),
      section_index: ctx.sectionIndex,
      family_id: 'transition',
      rule_id: 'skip:even_pages',
      inputs: {
        pages_so_far: ctx.pageInstances.length,
        reason: 'нет висящей правой страницы',
      },
    });
    return;
  }

  const pageIndex = ctx.pageInstances.length;
  const position: 'right' = 'right'; // всегда правая по определению

  // 2. Партнёр задал конкретный мастер?
  if (masterName) {
    const master = ctx.bundle.mastersByName.get(masterName);
    if (!master) {
      ctx.warnings.push(
        `transition_master_missing: '${masterName}' не найден в template_set, применяю встроенное правило`,
      );
      // fallthrough на встроенное правило
    } else {
      const category = classifyMasterCategory(master);
      if (category === null) {
        ctx.warnings.push(
          `transition_master_invalid: '${masterName}' не имеет J-категории placeholder'ов`,
        );
        return;
      }
      const need = PHOTO_COUNT[category];
      const have = ctx.available[category];
      if (have < need) {
        ctx.warnings.push(
          `transition_skipped: '${masterName}' (нужно ${need} фото ${category}, доступно ${have})`,
        );
        return;
      }
      placeTransitionPage(ctx, master, category, position, pageIndex);
      return;
    }
  }

  // 3. Встроенное правило по умолчанию.
  for (const category of PRIORITY) {
    if (ctx.available[category] < PHOTO_COUNT[category]) continue;
    const master = findCommonMasterForCategory(
      ctx.bundle.mastersByName,
      category,
      position,
    );
    if (!master) continue;
    placeTransitionPage(ctx, master, category, position, pageIndex);
    return;
  }

  // 4. Ничего не подошло.
  ctx.warnings.push(
    'transition_skipped: нет фото ни одной категории или подходящих J-мастеров для переходной страницы',
  );
  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: 'skip:no_master_or_photos',
    inputs: { available: { ...ctx.available } },
  });
}

function placeTransitionPage(
  ctx: SectionFillContext,
  master: SpreadTemplate,
  category: Category,
  position: 'right',
  pageIndex: number,
): void {
  const bindings = bindCommonPhotos(master, ctx.input, ctx.available);

  const consumes: SlotConsumes = {};
  consumes[category] = PHOTO_COUNT[category];
  decrementAvailable(ctx.available, consumes);

  ctx.pageInstances.push({
    master_id: master.id,
    bindings,
  });

  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: `semantic:${category}:${master.name}`,
    inputs: {
      category,
      count: PHOTO_COUNT[category],
      master_name: master.name,
      position,
    },
  });
}
