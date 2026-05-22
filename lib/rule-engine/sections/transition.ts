/**
 * Заполнение секции type='transition' для buildFromSectionStructure.
 *
 * РЭ.31.2: переписано на семантический поиск J-мастеров.
 *
 * Назначение секции
 * ─────────────────
 * Если личный раздел `students` закончился на левой странице (нечётное
 * количество страниц перед transition) — правая страница разворота
 * остаётся «висящей». Секция transition достраивает её одним J-мастером
 * общего раздела.
 *
 * Алгоритм:
 *   1. Если pageInstances.length чётный → секция не нужна, выход без warnings.
 *   2. Жадно пробуем категории по убыванию площади:
 *      full_class → half_class → quarter → sixth.
 *      На первой где хватает фото И найден чистый J-мастер с зеркальным
 *      вариантом '-Right' — кладём страницу.
 *   3. Если ни одной категории не хватило — секция пропускается с warning.
 *
 * Использует те же helper'ы что common-required.ts (findCommonMaster через
 * slot_capacity, tryRightMirror для зеркального варианта).
 *
 * Что НЕ делает (отложено в РЭ.31.Б на потом):
 *   - Не строит левую сторону переходного разворота (комбо «N учеников +
 *     1 общая»). Это требует мастеров типа `transition-left` которых в
 *     template_set пока не предусмотрено. Семантический поиск не сможет
 *     их найти даже если бы они появились — нужно расширение типов
 *     запросов.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { CommonPhotoCounts, SlotConsumes } from '../slot-chains';
import { bindCommonPhotos, decrementAvailable } from './common';
import type { SectionFillContext } from './shared';

// ─── Копия типов и helper'ов из common-required.ts ────────────────────────
// Сейчас дублируются. Если станет третий потребитель — вынесем в shared.

type CommonCategory = 'full_class' | 'half_class' | 'quarter' | 'sixth';

const PHOTO_COUNT_FOR_CATEGORY: Record<CommonCategory, number> = {
  full_class: 1,
  half_class: 2,
  quarter: 4,
  sixth: 6,
};

const CATEGORY_PRIORITY: CommonCategory[] = ['full_class', 'half_class', 'quarter', 'sixth'];

function tryRightMirror(
  master: SpreadTemplate,
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
): SpreadTemplate {
  if (master.name.endsWith('-Left')) {
    const rightName = master.name.replace(/-Left$/, '-Right');
    const right = mastersByName.get(rightName);
    if (right) return right;
  }
  return master;
}

type MasterCapability = {
  full_class: number;
  half_class: number;
  quarter: number;
  sixth: number;
  is_student_master: boolean;
};

function analyzeMasterPlaceholders(master: SpreadTemplate): MasterCapability {
  const result: MasterCapability = {
    full_class: 0,
    half_class: 0,
    quarter: 0,
    sixth: 0,
    is_student_master: false,
  };
  let collagePhotoCount = 0;
  for (const ph of master.placeholders) {
    const label = ph.label.toLowerCase();
    if (label === 'classphotoframe') {
      result.full_class += 1;
    } else if (label.match(/^halfphoto_\d+$/)) {
      result.half_class += 1;
    } else if (label.match(/^quarterphoto_\d+$/)) {
      result.quarter += 1;
    } else if (label.match(/^collagephoto_\d+$/)) {
      collagePhotoCount += 1;
    } else if (
      label.match(/^studentportrait_\d+$/) ||
      label.match(/^studentname_\d+$/)
    ) {
      result.is_student_master = true;
    }
  }
  if (collagePhotoCount === 6) {
    result.sixth = 6;
  } else if (collagePhotoCount === 4) {
    result.quarter = Math.max(result.quarter, 4);
  }
  return result;
}

function findCommonMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  category: CommonCategory,
  count: number,
  position: 'left' | 'right',
): SpreadTemplate | null {
  const candidates: Array<{ master: SpreadTemplate; cap: number }> = [];

  for (const master of Array.from(mastersByName.values())) {
    const ability = analyzeMasterPlaceholders(master);
    if (ability.is_student_master) continue;

    const slotsInCategory = ability[category];
    if (slotsInCategory < count) continue;

    let hasOtherCategory = false;
    for (const cat of CATEGORY_PRIORITY) {
      if (cat === category) continue;
      if (ability[cat] > 0) {
        hasOtherCategory = true;
        break;
      }
    }
    if (hasOtherCategory) continue;

    candidates.push({ master, cap: slotsInCategory });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.cap !== b.cap) return a.cap - b.cap;
    return a.master.name.localeCompare(b.master.name);
  });

  const chosen = candidates[0].master;
  if (position === 'right') {
    return tryRightMirror(chosen, mastersByName);
  }
  return chosen;
}

function hasEnoughPhotos(
  available: CommonPhotoCounts,
  category: CommonCategory,
): boolean {
  return available[category] >= PHOTO_COUNT_FOR_CATEGORY[category];
}

// ─── Главная функция ───────────────────────────────────────────────────────

export function fillTransitionSection(ctx: SectionFillContext): void {
  // Шаг 1: проверка нечётности. Если предыдущая страница уже на правой
  // (чётное общее количество страниц) → переходная не нужна.
  if (ctx.pageInstances.length % 2 === 0) {
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2),
      section_index: ctx.sectionIndex,
      family_id: 'transition',
      rule_id: 'skip:even_pages',
      inputs: {
        pages_so_far: ctx.pageInstances.length,
        reason: 'нет висящей правой страницы (чётное количество страниц)',
      },
    });
    return;
  }

  // Шаг 2: жадно по приоритетам — нужна правая страница.
  const pageIndex = ctx.pageInstances.length;
  const position: 'left' | 'right' = 'right';  // всегда right по определению

  let pickedMaster: SpreadTemplate | null = null;
  let pickedCategory: CommonCategory | null = null;

  for (const category of CATEGORY_PRIORITY) {
    if (!hasEnoughPhotos(ctx.available, category)) continue;
    const count = PHOTO_COUNT_FOR_CATEGORY[category];
    const master = findCommonMaster(ctx.bundle.mastersByName, category, count, position);
    if (!master) continue;
    pickedMaster = master;
    pickedCategory = category;
    break;
  }

  if (!pickedMaster || !pickedCategory) {
    ctx.warnings.push(
      `transition_skipped: правая страница переходного разворота пропущена — ` +
        `нет фото ни одной категории или подходящих J-мастеров`,
    );
    ctx.decisionTrace.push({
      spread_index: Math.floor(pageIndex / 2),
      section_index: ctx.sectionIndex,
      family_id: 'transition',
      rule_id: 'skip:no_master_or_photos',
      inputs: {
        available: { ...ctx.available },
      },
    });
    return;
  }

  // Шаг 3: bindings и pageInstance.
  const bindings = bindCommonPhotos(pickedMaster, ctx.input, ctx.available);

  const consumes: SlotConsumes = {};
  consumes[pickedCategory] = PHOTO_COUNT_FOR_CATEGORY[pickedCategory];
  decrementAvailable(ctx.available, consumes);

  ctx.pageInstances.push({
    master_id: pickedMaster.id,
    bindings,
  });

  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: `semantic:${pickedCategory}:${pickedMaster.name}`,
    inputs: {
      category: pickedCategory,
      count: PHOTO_COUNT_FOR_CATEGORY[pickedCategory],
      master_name: pickedMaster.name,
      position,
    },
  });
}
