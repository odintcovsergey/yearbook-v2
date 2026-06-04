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
import { humanPhotoCategory, type SectionFillContext } from './shared';

/** Категории общих фото — соответствуют полям CommonPhotoCounts. */
type CommonCategory =
  | 'full_class'
  | 'half_class'
  | 'quarter'
  | 'sixth'
  | 'collage'
  | 'spread';

/**
 * РЭ.38.1 (25.05.2026): резервные варианты на случай когда выбранный
 * партнёром мастер не строится из-за нехватки фотографий нужной категории.
 *
 * Идея: партнёр в шаблоне указал J-Half (нужно 2 half_class), но фоток
 * этой категории не хватило. Прежде чем оставить страницу пустой, engine
 * пробует подобрать «похожий» мастер из соседних категорий. Это снижает
 * число пустых страниц в готовом альбоме и даёт партнёру понятный
 * info-warning «вместо X поставлен Y», вместо тревожного скип-warning'а.
 *
 * Логика выбора резервов:
 *   • Для half_class — попробовать J-Sixth-6 (sixth) → J-Full (full)
 *   • Для sixth — J-Half → J-Full
 *   • Для collage — J-Half → J-Full
 *   • Для full_class — J-Half → J-Sixth-6
 *   • Для quarter — J-Half → J-Sixth-6 → J-Full
 *
 * Сначала идут «дешёвые» по дефицитности (sixth обычно больше всех),
 * затем full_class (тоже умеренно дефицитен — обычно 1-3 кадра).
 *
 * Партнёр может убрать engine-fallback'и переопределив страницы вручную
 * в редакторе (РЭ.38.2 — clickable замена шаблона на пустой странице).
 */
type FallbackOption = {
  masterName: string;
  // category и needCount выводятся через analyzeMasterCapability(),
  // здесь только подсказка для документации:
  description: string;
};

const FALLBACK_CHAIN: Record<Exclude<CommonCategory, 'spread'>, FallbackOption[]> = {
  half_class: [
    { masterName: 'J-Sixth-6', description: '6 фото 1/6 класса' },
    { masterName: 'J-Full', description: '1 общее фото класса' },
  ],
  sixth: [
    { masterName: 'J-Half', description: '2 половинных фото' },
    { masterName: 'J-Full', description: '1 общее фото класса' },
  ],
  collage: [
    { masterName: 'J-Half', description: '2 половинных фото' },
    { masterName: 'J-Full', description: '1 общее фото класса' },
  ],
  full_class: [
    { masterName: 'J-Half', description: '2 половинных фото' },
    { masterName: 'J-Sixth-6', description: '6 фото 1/6 класса' },
  ],
  quarter: [
    { masterName: 'J-Half', description: '2 половинных фото' },
    { masterName: 'J-Sixth-6', description: '6 фото 1/6 класса' },
    { masterName: 'J-Full', description: '1 общее фото класса' },
  ],
};

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
 *   sixthphoto_N (N>0)   → sixth (count=N) — мастера J-Sixth-* («1/6 класса»)
 *   collagephoto_N (N>0) → collage (count=N) — мастера J-Collage-* («Коллаж»)
 *   spreadphoto          → spread (count=1)
 *
 * 04.06.2026 (tz-sixth-collage-split.md): sixth и collage разведены.
 * Метка sixthphoto_N читается из пула common_photos.sixth, collagephoto_N —
 * из common_photos.collage. category и pool теперь синхронны по метке
 * (см. bindCommonPhotos / bindOverrideMasterPlaceholders).
 *
 * Возвращает null если мастер не имеет ни одной J-категории. Это
 * означает что в `pages` пресета указан некорректный мастер (например
 * партнёр случайно положил студенческий — но в нашем UI пикер
 * это запрещает; теоретически возможно через прямую правку БД).
 */
function analyzeMasterCapability(master: SpreadTemplate): MasterCapability {
  let halfCount = 0;
  let quarterCount = 0;
  let sixthCount = 0;
  let collageCount = 0;
  let hasFull = false;
  let hasSpread = false;

  for (const ph of master.placeholders ?? []) {
    const label = ph.label.toLowerCase();
    if (label === 'classphotoframe') hasFull = true;
    else if (label.match(/^halfphoto_\d+$/)) halfCount++;
    else if (label.match(/^quarterphoto_\d+$/)) quarterCount++;
    else if (label.match(/^sixthphoto_\d+$/)) sixthCount++;
    else if (label.match(/^collagephoto_\d+$/)) collageCount++;
    else if (label === 'spreadphoto') hasSpread = true;
  }

  if (hasSpread) return { category: 'spread', count: 1 };
  if (sixthCount > 0) return { category: 'sixth', count: sixthCount };
  if (collageCount > 0) return { category: 'collage', count: collageCount };
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

  // РЭ.35.Ж.3: счётчик «виртуальной позиции» в общем разделе.
  // Партнёр в UI видит каждую страницу как ЛЕВАЯ / ПРАВАЯ / РАЗВОРОТ.
  // Engine обязан уважать эту разметку.
  //
  // virtualPos:
  //   - чётный (0, 2, 4) → партнёр ожидает ЛЕВАЯ
  //   - нечётный (1, 3, 5) → партнёр ожидает ПРАВАЯ
  //   - после J-Spread (разворот) — пропускается на 2 (J-Spread занимает
  //     обе позиции одного разворота)
  //   - skipped страницы НЕ продвигают virtualPos (партнёр всё равно
  //     ожидает что СЛЕДУЮЩАЯ страница ляжет на ту же позицию, что
  //     skipped была бы)
  let virtualPos = 0;

  for (let i = 0; i < pages.length; i++) {
    const pageEntry = pages[i];
    const masterName = pageEntry.master_name;
    const expectedSide: 'left' | 'right' = virtualPos % 2 === 0 ? 'left' : 'right';

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
        `common_required_no_category: '${masterName}' не имеет J-категории placeholder'ов (classphotoframe / halfphoto / quarterphoto / sixthphoto / collagephoto / spreadphoto)`,
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
    // РЭ.38.1 (25.05.2026): если не хватает — пробуем подобрать резервный
    // мастер из FALLBACK_CHAIN прежде чем оставить страницу пустой.
    // Это снижает число пустых страниц в готовом альбоме и даёт партнёру
    // info-warning вместо тревожного skip-warning'а.
    let activeMaster = baseMaster;
    // ability.category уже non-null после early return на шаге 2.
    // Явно фиксируем тип чтобы TS не терял narrowing после let-присваивания.
    let activeAbility: { category: Exclude<CommonCategory, never>; count: number } = {
      category: ability.category,
      count: ability.count,
    };
    let usedFallback: { from: string; to: string; reason: string } | null = null;

    const haveCount = availablePhotos(ctx, activeAbility.category, spreadConsumed);
    if (haveCount < activeAbility.count) {
      // Не хватает. Пробуем fallback-цепочку (только для не-spread категорий —
      // spread мастера занимают целый разворот и заменить его одной страницей
      // нельзя).
      let fallbackFound = false;
      if (activeAbility.category !== 'spread') {
        const chain = FALLBACK_CHAIN[activeAbility.category];
        for (const option of chain) {
          const candidate = ctx.bundle.mastersByName.get(option.masterName);
          if (!candidate) continue; // у партнёра нет такого мастера
          const candidateAbility = analyzeMasterCapability(candidate);
          if (candidateAbility.category === null) continue;
          if (candidateAbility.category === 'spread') continue; // защита
          const candidateHave = availablePhotos(
            ctx,
            candidateAbility.category,
            spreadConsumed,
          );
          if (candidateHave < candidateAbility.count) continue; // тоже не хватает

          // Подходит — переключаемся на этот мастер.
          // candidateAbility.category уже non-null (проверено выше).
          activeMaster = candidate;
          activeAbility = {
            category: candidateAbility.category,
            count: candidateAbility.count,
          };
          usedFallback = {
            from: masterName,
            to: candidate.name,
            reason: `${humanPhotoCategory(ability.category)}: загружено ${haveCount}, нужно ${ability.count}`,
          };
          fallbackFound = true;
          break;
        }
      }

      if (!fallbackFound) {
        // Ни один резервный вариант не подошёл — страница остаётся пустой.
        const needMore = ability.count - haveCount;
        const categoryRu = humanPhotoCategory(ability.category);
        ctx.warnings.push(
          `common_required_page_skipped: страница ${i + 1} общего раздела — ` +
            `шаблон «${masterName}» пропущен. Нужно ${ability.count} фото типа ` +
            `«${categoryRu}», загружено ${haveCount}. Загрузите ещё ${needMore} ` +
            `или замените шаблон вручную в редакторе.`,
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
    }

    // Если был выбран fallback — оставим info warning с понятным объяснением.
    if (usedFallback) {
      ctx.warnings.push(
        `common_required_fallback_used: страница ${i + 1} общего раздела — ` +
          `вместо шаблона «${usedFallback.from}» выбран «${usedFallback.to}», ` +
          `потому что не хватило фото (${usedFallback.reason}). ` +
          `Чтобы вернуть исходный шаблон, загрузите больше фото нужного типа ` +
          `или замените шаблон вручную в редакторе.`,
      );
      ctx.decisionTrace.push({
        spread_index: Math.floor(ctx.pageInstances.length / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-required',
        rule_id: `fallback:${usedFallback.from}->${usedFallback.to}`,
        inputs: {
          page_num: i + 1,
          requested_master: usedFallback.from,
          actual_master: usedFallback.to,
          original_category: ability.category,
          fallback_category: activeAbility.category,
        },
      });
    }

    // 4. Особый случай — J-Spread (is_spread=true).
    // Занимает оба места разворота. Кладём ДВЕ записи pageInstances
    // с одинаковым master_id. Build engine при группировке
    // pageInstances → SpreadInstance детектирует пару через is_spread флаг.
    //
    // РЭ.35.Ж.3: J-Spread всегда начинает новый разворот. Помечаем
    // первую запись section_start=true если фактическая позиция
    // в pageInstances нечётна (висит разворот). virtualPos после
    // J-Spread продвигается на 2 (он занял оба слота разворота).
    if (activeMaster.is_spread === true) {
      const bindings = bindCommonPhotos(activeMaster, ctx.input, ctx.available);
      const startNewSpread = ctx.pageInstances.length % 2 !== 0;
      ctx.pageInstances.push({
        master_id: activeMaster.id,
        bindings,
        ...(startNewSpread ? { section_start: true } : {}),
      });
      ctx.pageInstances.push({ master_id: activeMaster.id, bindings: {} });
      spreadConsumed += 1;
      virtualPos += 2; // J-Spread занял две виртуальные позиции
      ctx.decisionTrace.push({
        spread_index: Math.floor((ctx.pageInstances.length - 2) / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-required',
        rule_id: `pages:${i + 1}:${activeMaster.name}:spread${startNewSpread ? ':forced_new' : ''}`,
        inputs: {
          page_num: i + 1,
          master_name: activeMaster.name,
          category: 'spread',
          count: 1,
          forced_new_spread: startNewSpread,
        },
      });
      continue;
    }

    // 5. Обычная страница. РЭ.35.Ж.3: жёсткая привязка к ожидаемой
    // стороне. Если expectedSide='left' но фактическая позиция
    // (по pageInstances.length) нечётна (то есть страница попала бы
    // на ПРАВУЮ предыдущего разворота) — помечаем section_start=true,
    // шаг 6 группировки закроет предыдущий разворот висящим и
    // эта страница станет left нового разворота.
    //
    // Аналогично для expectedSide='right' и чётной позиции: висит
    // открытый разворот без правой — это редкий случай, может
    // возникнуть когда предыдущая страница была skipped. В этом случае
    // добавляем «пустую» страницу-плейсхолдер (master_id=null не делаем,
    // а пометить пустой записью невозможно в текущей архитектуре —
    // оставляем как warning).
    const actualSide: 'left' | 'right' =
      ctx.pageInstances.length % 2 === 0 ? 'left' : 'right';
    const sideMismatch = actualSide !== expectedSide;
    const position: 'left' | 'right' = expectedSide;
    const master =
      position === 'right'
        ? tryRightMirror(activeMaster, ctx.bundle.mastersByName)
        : activeMaster;

    const bindings = bindCommonPhotos(master, ctx.input, ctx.available);

    // Декремент available только для не-spread категорий.
    const consumes: SlotConsumes = {};
    consumes[activeAbility.category as Exclude<CommonCategory, 'spread'>] = activeAbility.count;
    decrementAvailable(ctx.available, consumes);

    ctx.pageInstances.push({
      master_id: master.id,
      bindings,
      // Если ожидается LEFT, а фактически нечётно (попадёт на правую) —
      // section_start закроет предыдущий висящим, страница встанет на левую.
      // Если ожидается RIGHT, а фактически чётно (попадёт на левую) —
      // section_start тоже закроет (но мы потеряем парность — это уже
      // глубже, и означает что один из предыдущих pages был skipped).
      ...(sideMismatch && expectedSide === 'left' ? { section_start: true } : {}),
    });
    virtualPos += 1;

    ctx.decisionTrace.push({
      spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-required',
      rule_id: `pages:${i + 1}:${master.name}`,
      inputs: {
        page_num: i + 1,
        master_name: master.name,
        category: activeAbility.category,
        count: activeAbility.count,
        position,
      },
    });
  }
}
