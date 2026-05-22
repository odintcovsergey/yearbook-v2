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
 * Сопоставление категории → ключ в slot_capacity мастера.
 * Категории common-фото в БД фото называются full_class/half_class/quarter/sixth.
 * Соответствующие slot_capacity ключи мастеров: photos_full/half/quarter/sixth.
 */
type SlotCapacityKey = 'photos_full' | 'photos_half' | 'photos_quarter' | 'photos_sixth';

const SLOT_KEY_FOR_CATEGORY: Record<CommonCategory, SlotCapacityKey> = {
  full_class: 'photos_full',
  half_class: 'photos_half',
  quarter: 'photos_quarter',
  sixth: 'photos_sixth',
};

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
 * Семантический поиск J-мастера для одной категории.
 *
 * Ищет мастера у которого slot_capacity[slot_key] >= count, остальные
 * фото-слоты = 0 (мастер «чистый» под одну категорию, без смешения).
 *
 * Если несколько подходящих мастеров — берёт с минимальным slot_capacity
 * (нет смысла брать мастер на 6 sixth-фото когда нужно 6 — точное
 * совпадение лучше).
 */
function findCommonMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  category: CommonCategory,
  count: number,
  position: 'left' | 'right',
): SpreadTemplate | null {
  const slotKey = SLOT_KEY_FOR_CATEGORY[category];

  // Все мастера у которых нужная категория >= count.
  const candidates: SpreadTemplate[] = [];
  for (const master of Array.from(mastersByName.values())) {
    const cap = master.slot_capacity ?? {};
    const slotValue = (cap[slotKey] as number | undefined) ?? 0;
    if (slotValue < count) continue;

    // Отсеиваем мастера которые «смешанные» — содержат и студенческие
    // слоты, и общие фото. Для общего раздела нужны чистые J-мастера.
    // Чистый J-мастер: students=0 (или не задано) и нет других photos_*
    // кроме нужной категории.
    const students = (cap.students as number | undefined) ?? 0;
    if (students > 0) continue;

    // Проверяем что других категорий = 0 (мастер чистый).
    let hasOtherCategory = false;
    for (const cat of CATEGORY_PRIORITY) {
      if (cat === category) continue;
      const otherKey = SLOT_KEY_FOR_CATEGORY[cat];
      const otherValue = (cap[otherKey] as number | undefined) ?? 0;
      if (otherValue > 0) {
        hasOtherCategory = true;
        break;
      }
    }
    if (hasOtherCategory) continue;

    candidates.push(master);
  }

  if (candidates.length === 0) return null;

  // Сортируем по slot_capacity[slot_key] возрастающе — берём минимально
  // подходящий (точное совпадение в начале).
  candidates.sort((a, b) => {
    const va = (a.slot_capacity?.[slotKey] as number | undefined) ?? 0;
    const vb = (b.slot_capacity?.[slotKey] as number | undefined) ?? 0;
    return va - vb;
  });

  const chosen = candidates[0];
  // Зеркальный мастер для правой позиции (если такой есть в template_set).
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
