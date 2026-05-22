/**
 * Заполнение секции type='common_required' для buildFromSectionStructure.
 *
 * РЭ.32 (конструктор общего раздела). Полная замена legacy density-таблицы.
 * Партнёр в редакторе шаблона задаёт упорядоченный массив страниц:
 *   { type: 'common_required', pages: [{ master_name: 'J-Quarter-Left' }, ...] }
 * Engine просто проходит список и кладёт страницы — никакой логики выбора
 * мастеров в коде. Логика общего раздела живёт в данных пресета.
 *
 * Что делает функция:
 *   1. Для каждой записи pages находит мастер в template_set по имени.
 *   2. Определяет категорию фото по placeholders (full_class / half_class /
 *      quarter / sixth / spread).
 *   3. Если фото в категории хватает — кладёт страницу, декрементит available.
 *   4. Если позиция страницы оказалась правой И в template_set есть
 *      <master_name>-Right — автоматически берёт зеркальный мастер.
 *   5. J-Spread (is_spread=true) занимает обе позиции разворота:
 *      кладётся ДВЕ записи pageInstances с одинаковым master_id (как делают
 *      students.ts для E-Student-Standard). Build engine при группировке
 *      pageInstances → SpreadInstance детектирует пару через is_spread флаг.
 *
 * Предупреждения:
 *   - common_required_master_missing: <name> — мастер не найден в template_set
 *     (партнёр сменил дизайн или мастер был переименован)
 *   - common_required_no_category: <name> — мастер найден, но у него нет
 *     ни одной J-категории placeholder'ов (некорректный мастер)
 *   - common_required_page_skipped: <name> (category=X, need=N, have=M) —
 *     фото в категории не хватает, страница пропущена, остальные продолжают
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { SlotConsumes } from '../slot-chains';
import { bindCommonPhotos, decrementAvailable } from './common';
import type { SectionFillContext } from './shared';

/** Категории общих фото — соответствуют полям CommonPhotoCounts. */
type CommonCategory = 'full_class' | 'half_class' | 'quarter' | 'sixth' | 'spread';

/** Возможности мастера, выведенные из placeholders. */
type MasterCapability = {
  category: CommonCategory | null;
  count: number;
};

/**
 * Анализирует placeholders мастера и возвращает его «вместимость» —
 * одна категория и сколько фото он потребляет на страницу.
 *
 * Маппинг placeholder → category:
 *   classphotoframe      → full_class (count=1)
 *   halfphoto_N (2 шт.)  → half_class (count=2)
 *   quarterphoto_N (4)   → quarter (count=4)
 *   collagephoto_N (6)   → sixth (count=6)
 *   collagephoto_N (4)   → quarter (count=4) — мастер J-Collage-4
 *   spreadphoto          → spread (count=1)
 *
 * Возвращает null если мастер не имеет ни одной J-категории. Это
 * означает что в `pages` пресета указан некорректный мастер (например
 * партнёр случайно положил студенческий — но в нашем UI пикер
 * это запрещает; теоретически возможно через прямую правку БД).
 */
function analyzeMasterCapability(master: SpreadTemplate): MasterCapability {
  let halfCount = 0;
  let quarterCount = 0;
  let collageCount = 0;
  let hasFull = false;
  let hasSpread = false;

  for (const ph of master.placeholders ?? []) {
    const label = ph.label.toLowerCase();
    if (label === 'classphotoframe') hasFull = true;
    else if (label.match(/^halfphoto_\d+$/)) halfCount++;
    else if (label.match(/^quarterphoto_\d+$/)) quarterCount++;
    else if (label.match(/^collagephoto_\d+$/)) collageCount++;
    else if (label === 'spreadphoto') hasSpread = true;
  }

  if (hasSpread) return { category: 'spread', count: 1 };
  if (collageCount === 6) return { category: 'sixth', count: 6 };
  if (collageCount === 4) return { category: 'quarter', count: 4 };
  if (quarterCount >= 4) return { category: 'quarter', count: 4 };
  if (halfCount >= 2) return { category: 'half_class', count: 2 };
  if (hasFull) return { category: 'full_class', count: 1 };
  return { category: null, count: 0 };
}

/**
 * Зеркальный вариант мастера если он есть в template_set.
 * Если имя мастера НЕ оканчивается на -Left — пробуем то же имя + '-Right'.
 * Если у мастера в имени уже есть -Left — пробуем заменить на -Right.
 * Если ничего из этого в template_set нет — возвращаем исходный мастер
 * (универсальный для обеих позиций).
 */
function tryRightMirror(
  master: SpreadTemplate,
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
): SpreadTemplate {
  // Вариант 1: имя оканчивается на -Left.
  if (master.name.endsWith('-Left')) {
    const rightName = master.name.replace(/-Left$/, '-Right');
    const right = mastersByName.get(rightName);
    if (right) return right;
  }
  // Вариант 2: имя без суффикса.
  const rightName = master.name + '-Right';
  const right = mastersByName.get(rightName);
  if (right) return right;
  return master;
}

/**
 * Сколько фото категории доступно сейчас в ctx.available.
 * Для категории 'spread' — берём из input.common_photos.spread.length
 * минус уже потреблённые (J-Spread декрементит свой счётчик отдельно).
 */
function availablePhotos(
  ctx: SectionFillContext,
  category: CommonCategory,
  spreadConsumed: number,
): number {
  if (category === 'spread') {
    return ctx.input.common_photos.spread.length - spreadConsumed;
  }
  return ctx.available[category];
}

/**
 * Главная функция секции.
 *
 * Читает pages из section_structure entry. Если pages отсутствует или
 * пуст — секция пропускается с warning (старая совместимость).
 */
export function fillCommonRequiredSection(
  ctx: SectionFillContext,
  pages: { master_name: string }[] | undefined,
): void {
  if (!pages || pages.length === 0) {
    ctx.warnings.push(
      'common_required_empty: общий раздел в шаблоне не настроен (партнёр должен добавить страницы в редакторе шаблона)',
    );
    return;
  }

  // Локальный счётчик потреблённых spread-фото (для category='spread';
  // обычные категории трекаются через ctx.available, которую декрементит
  // decrementAvailable).
  let spreadConsumed = 0;

  for (let i = 0; i < pages.length; i++) {
    const pageEntry = pages[i];
    const masterName = pageEntry.master_name;

    // 1. Находим мастер в template_set.
    const baseMaster = ctx.bundle.mastersByName.get(masterName);
    if (!baseMaster) {
      ctx.warnings.push(
        `common_required_master_missing: '${masterName}' не найден в template_set (партнёр сменил дизайн или мастер переименован)`,
      );
      ctx.decisionTrace.push({
        spread_index: Math.floor(ctx.pageInstances.length / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-required',
        rule_id: `skip:master_missing:${masterName}`,
        inputs: { page_num: i + 1, master_name: masterName },
      });
      continue;
    }

    // 2. Анализ возможностей.
    const ability = analyzeMasterCapability(baseMaster);
    if (ability.category === null) {
      ctx.warnings.push(
        `common_required_no_category: '${masterName}' не имеет J-категории placeholder'ов (classphotoframe / halfphoto / quarterphoto / collagephoto / spreadphoto)`,
      );
      ctx.decisionTrace.push({
        spread_index: Math.floor(ctx.pageInstances.length / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-required',
        rule_id: `skip:no_category:${masterName}`,
        inputs: { page_num: i + 1, master_name: masterName },
      });
      continue;
    }

    // 3. Хватает ли фото в категории.
    const haveCount = availablePhotos(ctx, ability.category, spreadConsumed);
    if (haveCount < ability.count) {
      ctx.warnings.push(
        `common_required_page_skipped: '${masterName}' (нужно ${ability.count} фото категории ${ability.category}, доступно ${haveCount})`,
      );
      ctx.decisionTrace.push({
        spread_index: Math.floor(ctx.pageInstances.length / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-required',
        rule_id: `skip:no_photos:${masterName}`,
        inputs: {
          page_num: i + 1,
          master_name: masterName,
          category: ability.category,
          need: ability.count,
          have: haveCount,
        },
      });
      continue;
    }

    // 4. Особый случай — J-Spread (is_spread=true).
    // Занимает оба места разворота. Кладём ДВЕ записи pageInstances
    // с одинаковым master_id (как у E-Student-Standard и других spread-
    // мастеров). Build engine при группировке pageInstances → SpreadInstance
    // детектирует пару через is_spread флаг.
    if (baseMaster.is_spread === true) {
      // Если pageInstances нечётный — выравниваем (добавим placeholder?
      // нет, такой ситуации не должно быть, потому что в UI J-Spread
      // открывает новый разворот. Если всё-таки случилось — warning и
      // пропускаем).
      if (ctx.pageInstances.length % 2 !== 0) {
        ctx.warnings.push(
          `common_required_spread_misaligned: '${masterName}' (J-Spread) попал на нечётную позицию — engine ожидал начало разворота. Страница пропущена.`,
        );
        continue;
      }
      const bindings = bindCommonPhotos(baseMaster, ctx.input, ctx.available);
      ctx.pageInstances.push({ master_id: baseMaster.id, bindings });
      ctx.pageInstances.push({ master_id: baseMaster.id, bindings: {} });
      spreadConsumed += 1;
      ctx.decisionTrace.push({
        spread_index: Math.floor((ctx.pageInstances.length - 2) / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-required',
        rule_id: `pages:${i + 1}:${masterName}:spread`,
        inputs: {
          page_num: i + 1,
          master_name: masterName,
          category: 'spread',
          count: 1,
        },
      });
      continue;
    }

    // 5. Обычная страница. Определяем позицию (left/right) и зеркальный мастер.
    const position: 'left' | 'right' =
      ctx.pageInstances.length % 2 === 0 ? 'left' : 'right';
    const master =
      position === 'right'
        ? tryRightMirror(baseMaster, ctx.bundle.mastersByName)
        : baseMaster;

    const bindings = bindCommonPhotos(master, ctx.input, ctx.available);

    // Декремент available только для не-spread категорий.
    const consumes: SlotConsumes = {};
    consumes[ability.category as Exclude<CommonCategory, 'spread'>] = ability.count;
    decrementAvailable(ctx.available, consumes);

    ctx.pageInstances.push({
      master_id: master.id,
      bindings,
    });

    ctx.decisionTrace.push({
      spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-required',
      rule_id: `pages:${i + 1}:${master.name}`,
      inputs: {
        page_num: i + 1,
        master_name: master.name,
        category: ability.category,
        count: ability.count,
        position,
      },
    });
  }
}
