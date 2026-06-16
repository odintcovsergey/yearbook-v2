/**
 * Заполнение секции type='common' для buildFromSectionStructure.
 *
 * Поддерживаются два режима (см. SectionStructureEntry в types.ts):
 *
 *  Manual режим (исторический, РЭ.21.8.3):
 *    section = { type: 'common', slots: [H | Q | FULL | flex_A | ...] }
 *    Партнёр явно прописал какие слоты и в каком порядке. Engine идёт
 *    по slots[], для каждого вызывает tryFillSlot из slot-chains.
 *    Слот = 1 страница. Используется когда у партнёра творческий подход
 *    и он хочет точно контролировать структуру.
 *
 *  Auto режим (РЭ.21.8.8):
 *    section = { type: 'common', mode: 'auto', max_spreads: N }
 *    Engine сам решает что положить из пула common_photos, ориентируясь
 *    на «крупные → мелкие» категории (spread → full → half → quarter →
 *    sixth). Лимит: не больше N разворотов. Если фото не хватает на
 *    полный N — останавливается на K<N с warning.
 *    Принцип «лучше меньше разворотов, чем пустые слоты»: разворот
 *    добавляется только если обе страницы (или одна страница для
 *    is_spread мастера) могут быть полностью заполнены фото.
 *    Используется когда партнёр доверяет engine — простой workflow:
 *    загрузил фото по категориям, выбрал число разворотов, получил
 *    готовый альбом.
 *
 * В обоих режимах bindings заполняются placeholder-driven (как в teachers/
 * students/soft-intro/-final): идём по master.placeholders, для каждого
 * label решаем что положить из ещё не использованных фото пула.
 * Поддерживаемые labels:
 *  - classphotoframe → следующее full_class фото
 *  - halfphoto_N     → следующее half_class фото (N-е по очереди)
 *  - quarterphoto_N  → следующее quarter фото
 *  - sixthphoto_N    → следующее sixth фото («1/6 класса»)
 *  - collagephoto_N  → следующее collage фото («Коллаж»)
 *  - spreadphoto / spreadphoto_N → следующее spread фото (для J-Spread)
 *
 * Cursor-логика расхода фото: для каждой категории фото хранится индекс
 * первого ещё не использованного (через arr.length - available[k]).
 * Это позволяет нескольким мастерам (teachers G-FullClass, common
 * J-Full, students combined) брать разные фото из одного пула full_class.
 */

import type { SlotType } from '../types';
import type {
  CommonPhotoCounts,
  SlotConsumes,
  SlotPosition,
} from '../slot-chains';
import { tryFillSlot } from '../slot-chains';
import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { RulesAlbumInput } from '../types';
import type { SectionFillContext } from './shared';

// ─── Manual режим ──────────────────────────────────────────────────────────

export function fillCommonSection(
  ctx: SectionFillContext,
  slots: SlotType[],
): void {
  for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
    const slotType = slots[slotIdx];
    const pageIndex = ctx.pageInstances.length;
    const position: SlotPosition = pageIndex % 2 === 0 ? 'left' : 'right';

    const fill = tryFillSlot(slotType, ctx.available, position);
    if (!fill) {
      ctx.warnings.push(
        `slot_skipped: section #${ctx.sectionIndex} slot #${slotIdx} (${slotType}) — недостаточно общих фото`,
      );
      continue;
    }

    const master = ctx.bundle.mastersByName.get(fill.master_name);
    if (!master) {
      ctx.warnings.push(
        `master_not_found: '${fill.master_name}' (slot ${slotType}) ` +
          `отсутствует в template_set дизайна`,
      );
      continue;
    }

    // Bindings ДО decrement available (cursor-логика).
    const bindings = bindCommonPhotos(master, ctx.input, ctx.available);

    // Вычитаем потреблённые фото из пула.
    decrementAvailable(ctx.available, fill.consumes);

    ctx.pageInstances.push({ master_id: master.id, bindings });

    ctx.decisionTrace.push({
      spread_index: Math.floor(pageIndex / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-section',
      rule_id: `manual:${slotType}`,
      inputs: {
        slot_type: slotType,
        position,
        chain_trace: fill.trace,
        consumes: fill.consumes,
      },
    });
  }
}

// ─── Auto режим (РЭ.21.8.8) ────────────────────────────────────────────────

/**
 * Конфигурация попыток для одной страницы в auto-режиме.
 *
 * Порядок попыток (жадно по крупности):
 *   1. J-Full (1 full_class)
 *   2. J-Half (2 half_class)
 *   3. J-Quarter (page-any) или пара J-Quarter-Left/-Right (2 quarter)
 *   4. J-Sixth-6 (6 sixth) — «1/6 класса»
 *   5. J-Collage-6/5/4/3 (6→3 collage) — «Коллаж», самый крупный из набора
 *
 * Логика: для каждой позиции (left/right) пробуем шаги по очереди,
 * берём первый где хватает фото. Если ни один не подошёл — страница
 * "не получилась" (caller это видит и решает что делать).
 */
interface AutopackStep {
  category: keyof CommonPhotoCounts;
  count: number;
  masterName: string;
  /** Для зеркальных пар (J-Quarter-Left/Right): имя мастера на правой стороне. */
  rightVariant?: string;
  /**
   * Имя симметричного page-any мастера. Если он есть в template_set —
   * предпочитаем его паре masterName/rightVariant: правую сторону отдаёт
   * авто-зеркало (mirror-placeholders.ts), отдельный -Right не нужен.
   * Фолбэк на пару — для старых наборов (okeybook-default) без page-any.
   */
  preferAny?: string;
}

// Коллажи (J-Collage-6→5→4→3) перечислены от крупного к мелкому: автопак
// берёт первый шаг, где хватает collage-фото И мастер есть в наборе. Так
// «самый крупный помещающийся из присутствующих» выходит автоматически —
// без отдельной логики выбора (по аналогии с лестницей grid у учеников).
const AUTOPACK_STEPS: AutopackStep[] = [
  { category: 'full_class', count: 1, masterName: 'J-Full' },
  { category: 'half_class', count: 2, masterName: 'J-Half' },
  {
    category: 'quarter',
    count: 2,
    masterName: 'J-Quarter-Left',
    rightVariant: 'J-Quarter-Right',
    preferAny: 'J-Quarter',
  },
  { category: 'sixth', count: 6, masterName: 'J-Sixth-6' },
  { category: 'collage', count: 6, masterName: 'J-Collage-6' },
  { category: 'collage', count: 5, masterName: 'J-Collage-5' },
  { category: 'collage', count: 4, masterName: 'J-Collage-4' },
  { category: 'collage', count: 3, masterName: 'J-Collage-3' },
];

interface AutopackPagePick {
  master: SpreadTemplate;
  consumes: SlotConsumes;
  trace: string;
}

/**
 * Подобрать мастер для одной страницы в auto-режиме.
 *
 * Идёт по AUTOPACK_STEPS, берёт первый шаг где (а) хватает фото в категории
 * и (б) мастер существует в template_set. Возвращает null если ни один
 * шаг не подошёл (вызывающая сторона остановит autopack).
 *
 * @param available     — оставшиеся фото пула
 * @param position      — сторона страницы (для J-Quarter-Right варианта)
 * @param mastersByName — мастера template_set
 */
function pickAutopackPage(
  available: CommonPhotoCounts,
  position: SlotPosition,
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
): AutopackPagePick | null {
  for (let i = 0; i < AUTOPACK_STEPS.length; i++) {
    const step = AUTOPACK_STEPS[i];
    if (available[step.category] < step.count) continue;
    // Приоритет: симметричный page-any (preferAny) если он в наборе →
    // иначе правый вариант для правой стороны → иначе базовое имя.
    let effectiveName: string;
    if (step.preferAny && mastersByName.has(step.preferAny)) {
      effectiveName = step.preferAny;
    } else if (position === 'right' && step.rightVariant) {
      effectiveName = step.rightVariant;
    } else {
      effectiveName = step.masterName;
    }
    const master = mastersByName.get(effectiveName);
    if (!master) continue; // мастер не загружен в template_set — пробуем
                           // следующий шаг
    const consumes: SlotConsumes = {};
    consumes[step.category] = step.count;
    return {
      master,
      consumes,
      trace: `${effectiveName} (${step.count} ${step.category})`,
    };
  }
  return null;
}

/**
 * Заполнение секции common в auto-режиме.
 *
 * Алгоритм (см. doc-комментарий файла):
 *   for spread_idx in 1..max_spreads:
 *     left  = pickAutopackPage(available, 'left')
 *     right = pickAutopackPage(available_после_left, 'right')
 *     если оба нашлись → добавить разворот, потребить фото
 *     иначе → остановить, warning common_autopack_underflow
 *
 * Особый случай — J-Spread (мастер на разворот). Если в пуле есть spread
 * фото и в template_set есть мастер J-Spread (is_spread=true) — он
 * занимает оба места разворота. Сейчас НЕ реализован (мастера J-Spread
 * в template_set okeybook-default нет — см. screenshot template_set).
 * Spread фото попадают в warning common_no_spread_master с подсказкой
 * партнёру вручную вставить эти фото.
 */
export function fillCommonAutoSection(
  ctx: SectionFillContext,
  maxSpreads: number,
): void {
  // Spread категория: пока нет мастера J-Spread в okeybook-default,
  // фото из этой категории игнорируем с warning. Партнёр вставит вручную.
  // Реализация J-Spread мастера — отдельная задача (master-cleanup-tz §A5).
  const spreadCount = ctx.input.common_photos.spread.length;
  if (spreadCount > 0) {
    ctx.warnings.push(
      `common_no_spread_master: ${spreadCount} фото категории spread не размещены ` +
        `(мастер J-Spread отсутствует в template_set; партнёр вставит вручную)`,
    );
  }

  // Если лимит 0 — ничего не делаем.
  if (maxSpreads <= 0) {
    const totalAvailable =
      ctx.available.full_class +
      ctx.available.half_class +
      ctx.available.quarter +
      ctx.available.sixth +
      ctx.available.collage;
    if (totalAvailable > 0) {
      ctx.warnings.push(
        `common_autopack_disabled: max_spreads=0, ${totalAvailable} общих фото не размещены`,
      );
    }
    return;
  }

  let createdSpreads = 0;
  for (let spreadIdx = 0; spreadIdx < maxSpreads; spreadIdx++) {
    // Снапшот available чтобы откатить если правая страница не получилась.
    const snapshot: CommonPhotoCounts = { ...ctx.available };

    // Левая страница.
    const left = pickAutopackPage(
      ctx.available,
      'left',
      ctx.bundle.mastersByName,
    );
    if (!left) break;

    // Bindings ДО decrement (cursor-логика).
    const leftBindings = bindCommonPhotos(
      left.master,
      ctx.input,
      ctx.available,
    );
    decrementAvailable(ctx.available, left.consumes);

    // Правая страница.
    const right = pickAutopackPage(
      ctx.available,
      'right',
      ctx.bundle.mastersByName,
    );
    if (!right) {
      // Принцип «лучше меньше разворотов, чем пустые слоты» — откатываем
      // левую тоже и останавливаемся. Партнёр в редакторе может доставить
      // одиночную левую вручную если хочет.
      ctx.available.full_class = snapshot.full_class;
      ctx.available.half_class = snapshot.half_class;
      ctx.available.quarter = snapshot.quarter;
      ctx.available.sixth = snapshot.sixth;
      ctx.available.collage = snapshot.collage;
      break;
    }

    const rightBindings = bindCommonPhotos(
      right.master,
      ctx.input,
      ctx.available,
    );
    decrementAvailable(ctx.available, right.consumes);

    // Обе страницы получились — фиксируем разворот.
    const leftPageIndex = ctx.pageInstances.length;
    ctx.pageInstances.push({
      master_id: left.master.id,
      bindings: leftBindings,
    });
    ctx.pageInstances.push({
      master_id: right.master.id,
      bindings: rightBindings,
    });

    ctx.decisionTrace.push({
      spread_index: Math.floor(leftPageIndex / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-section',
      rule_id: `auto:${left.master.name}+${right.master.name}`,
      inputs: {
        spread_index_within_section: spreadIdx,
        left_trace: left.trace,
        right_trace: right.trace,
        left_consumes: left.consumes,
        right_consumes: right.consumes,
      },
    });

    createdSpreads++;
  }

  // Underflow warning: запрошено больше разворотов чем смогли создать.
  if (createdSpreads < maxSpreads) {
    const remainingPool =
      ctx.available.full_class +
      ctx.available.half_class +
      ctx.available.quarter +
      ctx.available.sixth +
      ctx.available.collage;
    ctx.warnings.push(
      `common_autopack_underflow: запрошено ${maxSpreads} разворотов, ` +
        `создано ${createdSpreads} (фото осталось в пуле: ${remainingPool}, ` +
        `недостаточно для полного разворота)`,
    );
  }
}

// ─── Общие хелперы ─────────────────────────────────────────────────────────

/**
 * Bindings для common-страницы (placeholder-driven).
 *
 * Поддерживаемые labels (case-insensitive):
 *  - classphotoframe        → input.common_photos.full_class[cursor]
 *  - halfphoto_N            → input.common_photos.half_class[cursor + N - 1]
 *  - quarterphoto_N         → input.common_photos.quarter[cursor + N - 1]
 *  - sixthphoto_N           → input.common_photos.sixth[cursor + N - 1]
 *  - collagephoto_N         → input.common_photos.collage[cursor + N - 1]
 *  - spreadphoto / spreadphoto_N → input.common_photos.spread[cursor + N - 1]
 *
 * Cursor для каждой категории = arr.length - available[k]. Это индекс
 * первого ещё не использованного фото. Так teachers G-FullClass и
 * common J-Full берут разные фото full_class, students combined тоже.
 *
 * Вызывается ДО decrementAvailable — порядок важен.
 */
export function bindCommonPhotos(
  master: SpreadTemplate,
  input: RulesAlbumInput,
  available: CommonPhotoCounts,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};

  const fullClassUsed = input.common_photos.full_class.length - available.full_class;
  const halfClassUsed = input.common_photos.half_class.length - available.half_class;
  const quarterUsed = input.common_photos.quarter.length - available.quarter;
  const sixthUsed = input.common_photos.sixth.length - available.sixth;
  const collageUsed = input.common_photos.collage.length - available.collage;
  // spread не имеет соответствующего поля в CommonPhotoCounts (мастер
  // J-Spread пока не используется), считаем напрямую через 0 — все
  // spread фото потенциально доступны. Если будущий J-Spread появится,
  // нужно будет добавить spread в available и пересчитать. См.
  // master-cleanup-tz §A5.
  const spreadUsed = 0;

  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    if (label === 'classphotoframe') {
      const photo = input.common_photos.full_class[fullClassUsed];
      if (photo) bindings[ph.label] = photo;
      continue;
    }

    const halfMatch = label.match(/^halfphoto_(\d+)$/);
    if (halfMatch) {
      const n = parseInt(halfMatch[1], 10);
      const photo = input.common_photos.half_class[halfClassUsed + n - 1];
      if (photo) bindings[ph.label] = photo;
      continue;
    }

    const quarterMatch = label.match(/^quarterphoto_(\d+)$/);
    if (quarterMatch) {
      const n = parseInt(quarterMatch[1], 10);
      const photo = input.common_photos.quarter[quarterUsed + n - 1];
      if (photo) bindings[ph.label] = photo;
      continue;
    }

    const sixthMatch = label.match(/^sixthphoto_(\d+)$/);
    if (sixthMatch) {
      const n = parseInt(sixthMatch[1], 10);
      const photo = input.common_photos.sixth[sixthUsed + n - 1];
      if (photo) bindings[ph.label] = photo;
      continue;
    }

    const collageMatch = label.match(/^collagephoto_(\d+)$/);
    if (collageMatch) {
      const n = parseInt(collageMatch[1], 10);
      const photo = input.common_photos.collage[collageUsed + n - 1];
      if (photo) bindings[ph.label] = photo;
      continue;
    }

    // spread (для будущего J-Spread мастера).
    if (label === 'spreadphoto') {
      const photo = input.common_photos.spread[spreadUsed];
      if (photo) bindings[ph.label] = photo;
      continue;
    }
    const spreadMatch = label.match(/^spreadphoto_(\d+)$/);
    if (spreadMatch) {
      const n = parseInt(spreadMatch[1], 10);
      const photo = input.common_photos.spread[spreadUsed + n - 1];
      if (photo) bindings[ph.label] = photo;
      continue;
    }
  }

  return bindings;
}

export function decrementAvailable(
  available: CommonPhotoCounts,
  consumes: SlotConsumes,
): void {
  if (consumes.full_class) available.full_class -= consumes.full_class;
  if (consumes.half_class) available.half_class -= consumes.half_class;
  if (consumes.quarter) available.quarter -= consumes.quarter;
  if (consumes.sixth) available.sixth -= consumes.sixth;
  if (consumes.collage) available.collage -= consumes.collage;
}
