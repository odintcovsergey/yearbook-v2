/**
 * Заполнение секции type='common_required' для buildFromSectionStructure.
 *
 * РЭ.31.Б.1: переписано на семантический поиск J-мастеров через
 * slot_capacity. Старая legacy-ветка (`pickRow` из таблицы OkeyBook
 * по density × sheet_type × students) удалена полностью — после РЭ.30
 * у глобальных пресетов density=NULL и таблица возвращала null для всех
 * новых пресетов, тихо ломая секцию.
 *
 * Новый алгоритм
 * ──────────────
 * Engine сам решает что положить на страницы общего раздела, исходя
 * только из доступных фото (`ctx.available`). Партнёр не указывает
 * структуру — она вычисляется автоматически.
 *
 * Сколько страниц строим:
 *   • Если у пресета есть `preset.common_required_spreads` (РЭ.31.Д) —
 *     ровно столько. Не реализовано в Б, добавится в Д.
 *   • Сейчас: строим пока хватает фото на минимум 1 категорию.
 *     Максимум 6 страниц (как в legacy-таблице) — чтобы не уйти в
 *     бесконечный цикл при большом количестве sixth-фото.
 *
 * Для каждой страницы:
 *   1. Определяем position (left/right) по чётности pageInstances.length.
 *   2. Пробуем категории в порядке убывания площади:
 *      • full_class (1 фото на страницу)
 *      • half_class (2 фото на страницу — J-Half)
 *      • quarter   (4 фото на страницу — J-Quarter-Left/Right)
 *      • sixth     (6 фото на страницу — J-Collage-6)
 *      • collage   (4 фото — J-Collage-4, если такой существует)
 *   3. На первой категории где хватает фото И найден мастер — кладём
 *      страницу, декрементим available, переходим к следующей странице.
 *   4. Если ни одна категория не дала результат — выходим из цикла
 *     (общие фото кончились).
 *
 * Зеркальные мастера
 * ──────────────────
 * Для quarter правый вариант J-Quarter-Right берётся через
 * pickRightVariant() — та же логика что и в legacy. Если правого нет в
 * template_set — fallback на левый.
 *
 * Семантический поиск мастера
 * ───────────────────────────
 * Мастер выбирается по slot_capacity, а не по имени. Конкретные имена
 * J-Full / J-Half / J-Quarter-Left / J-Collage-6 — это лишь имена в
 * okeybook-default; партнёр может назвать свои мастера иначе. Главное —
 * чтобы slot_capacity показывал какие фото потребляет.
 *
 * Например, J-Half в okeybook-default имеет:
 *   slot_capacity = { photos_half: 2 }
 * Алгоритм ищет мастер где photos_half >= 2 (и другие категории = 0),
 * берёт первый найденный. Имя при этом не проверяется.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { CommonPhotoCounts, SlotConsumes } from '../slot-chains';
import { bindCommonPhotos, decrementAvailable } from './common';
import type { SectionFillContext } from './shared';

/** Категории общих фото — те что есть в CommonPhotoCounts. */
type CommonCategory = 'full_class' | 'half_class' | 'quarter' | 'sixth';

/**
 * Сколько фото потребляет мастер каждой категории.
 * Если мастер J-Half с photos_half=2 — мы по нему «трачу 2 half_class фото».
 */
const PHOTO_COUNT_FOR_CATEGORY: Record<CommonCategory, number> = {
  full_class: 1,
  half_class: 2,
  quarter: 4,
  sixth: 6,
};

/** Приоритет категорий — большие фото идут раньше. */
const CATEGORY_PRIORITY: CommonCategory[] = ['full_class', 'half_class', 'quarter', 'sixth'];

/** Максимум страниц общего раздела (страховка от бесконечного цикла). */
const MAX_COMMON_REQUIRED_PAGES = 6;

/**
 * Зеркальные пары имён для правой позиции. Когда engine выбрал мастер
 * по slot_capacity и обнаружил что position='right' — пробует найти
 * мастер с именем base + '-Right' в template_set. Если есть — берёт его;
 * если нет — оставляет исходный (левый).
 */
function tryRightMirror(
  master: SpreadTemplate,
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
): SpreadTemplate {
  // Только J-Quarter-Left имеет известного зеркального брата.
  // Если имя оканчивается на '-Left' — пробуем '-Right'.
  if (master.name.endsWith('-Left')) {
    const rightName = master.name.replace(/-Left$/, '-Right');
    const right = mastersByName.get(rightName);
    if (right) return right;
  }
  return master;
}

/**
 * Возможности мастера, выведенные из placeholders.
 * Используется вместо slot_capacity которое у J-мастеров okeybook-default
 * сейчас не заполнено ({} у всех 7 мастеров). Placeholders — надёжный
 * источник правды о том, что мастер умеет.
 */
type MasterCapability = {
  full_class: number;
  half_class: number;
  quarter: number;
  sixth: number;
  is_student_master: boolean;
};

/**
 * Анализ placeholders → categories. Маппинг:
 *   classphotoframe          → full_class (1)
 *   halfphoto_N              → half_class (count)
 *   quarterphoto_N           → quarter (count)
 *   collagephoto_N (6 шт.)   → sixth (6)
 *   collagephoto_N (4 шт.)   → quarter (4)
 *   studentportrait_N        → не J-мастер (ученический)
 */
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

/**
 * Семантический поиск J-мастера для одной категории.
 *
 * Использует анализ placeholders (т.к. slot_capacity у J-мастеров пуст).
 * Отсеивает ученические мастера. Берёт чистый мастер под одну категорию,
 * с минимальным числом слотов для лучшего совпадения.
 */
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

    // Чистый мастер: другие категории = 0.
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

  // Сортировка: минимальный cap, потом по имени (детерминированность).
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

/**
 * Имеется ли в `available` достаточно фото для одной страницы категории.
 */
function hasEnoughPhotos(
  available: CommonPhotoCounts,
  category: CommonCategory,
): boolean {
  return available[category] >= PHOTO_COUNT_FOR_CATEGORY[category];
}

/**
 * Главная функция заполнения секции common_required.
 *
 * Жадно заполняет страницы общего раздела пока хватает фото или пока
 * не достигнут максимум MAX_COMMON_REQUIRED_PAGES.
 */
export function fillCommonRequiredSection(ctx: SectionFillContext): void {
  for (let pageNum = 0; pageNum < MAX_COMMON_REQUIRED_PAGES; pageNum++) {
    const pageIndex = ctx.pageInstances.length;
    const position: 'left' | 'right' = pageIndex % 2 === 0 ? 'left' : 'right';

    // Жадно идём по приоритетам категорий: full > half > quarter > sixth.
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
      // Нет подходящей категории на этой странице — заканчиваем секцию.
      // Это не warning — норма для случаев когда общие фото кончились.
      ctx.decisionTrace.push({
        spread_index: Math.floor(pageIndex / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-required',
        rule_id: `stop:no_more_photos`,
        inputs: {
          page_num: pageNum,
          available: { ...ctx.available },
        },
      });
      return;
    }

    // Bindings — общим хелпером (placeholder-driven, не зависит от способа выбора мастера).
    const bindings = bindCommonPhotos(pickedMaster, ctx.input, ctx.available);

    // Декремент available на потреблённое количество.
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
      family_id: 'common-required',
      rule_id: `semantic:${pickedCategory}:${pickedMaster.name}`,
      inputs: {
        page_num: pageNum,
        category: pickedCategory,
        count: PHOTO_COUNT_FOR_CATEGORY[pickedCategory],
        master_name: pickedMaster.name,
        position,
      },
    });
  }
}
