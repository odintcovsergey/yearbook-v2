/**
 * Заполнение секции type='transition' для buildFromSectionStructure.
 *
 * РЭ.21.8.11 (вариант C — упрощённый): достраивание правой страницы
 * переходного разворота когда личный раздел заканчивается на левой
 * странице (нечётное количество страниц перед).
 *
 * Контекст:
 * После секции `students` для density Standard/Medium/Light/Mini может
 * остаться «висящая» левая страница — последний ученик/группа учеников
 * на левой, а правая страница пустая. По таблице OkeyBook на этой
 * правой странице должен быть фрагмент общего раздела
 * («2×1/2 либо 6×1/6 либо 1 общая» — это тот же COLLAGE_OR_HALVES_OR_FULL
 * что в обязательном разделе).
 *
 * Левая сторона переходной (комбо «N учеников + 1 общая») в этом коммите
 * НЕ строится — там нужны комбо-мастера которых в template_set пока нет.
 * Отложено в РЭ.21.8.11b. См. master-cleanup-tz.md раздел H.
 *
 * Алгоритм:
 *  1. Если pageInstances.length чётный → секция не нужна, выход без warnings.
 *  2. Берём row.transition_right из таблицы OkeyBook
 *     (по preset.density × preset.sheet_type × students.length).
 *  3. Если null → выход (для этой комбинации переходная не определена).
 *  4. Жадно пробуем попытки из PageDescriptor — берём первую где хватает фото.
 *  5. Строим страницу с bindings и декрементим available.
 *
 * Секция размещается между students и common_required в section_structure.
 * Партнёр явно добавляет её в редакторе (или дефолтная section_structure
 * автоматически её содержит для нужных пресетов).
 */

import type { CommonPhotoCounts, SlotConsumes } from '../slot-chains';
import type { Density } from '../types';
import type { SpreadTemplate } from '@/lib/album-builder/types';
import { pickRow } from '../album-structure-okeybook';
import type {
  CommonCategory,
  PageAttempt,
  PageDescriptor,
} from '../album-structure-okeybook';
import { bindCommonPhotos, decrementAvailable } from './common';
import type { SectionFillContext } from './shared';

/** Зеркальные пары мастеров (та же логика что common-required.ts). */
const MIRROR_RIGHT: Record<string, string> = {
  'J-Quarter-Left': 'J-Quarter-Right',
};

function pickRightVariant(masterName: string): string {
  return MIRROR_RIGHT[masterName] ?? masterName;
}

function resolveDensityForTable(
  presetDensity: Density | null | undefined,
  presetId: string,
): Density | null {
  if (presetDensity) return presetDensity;
  if (presetId === 'maximum' || presetId === 'individual') return 'maximum';
  return null;
}

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

  // Шаг 2: ищем строку таблицы.
  const presetDensity = ctx.bundle.preset.density;
  const sheetType = ctx.bundle.preset.sheet_type;
  const studentsCount = ctx.input.students.length;
  const effectiveDensity = resolveDensityForTable(
    presetDensity,
    ctx.bundle.preset.id,
  );

  if (!effectiveDensity || !sheetType) {
    ctx.warnings.push(
      `transition_no_density: preset.density=${String(presetDensity)}, ` +
        `sheet_type=${String(sheetType)} — нельзя выбрать строку таблицы`,
    );
    return;
  }

  const row = pickRow(effectiveDensity, sheetType, studentsCount);
  if (!row) {
    ctx.warnings.push(
      `transition_no_row: нет строки таблицы для density=${effectiveDensity}, ` +
        `sheet_type=${sheetType}, students=${studentsCount}`,
    );
    return;
  }

  // Шаг 3: проверка transition_right.
  if (row.transition_right === null) {
    // Для этой комбинации переходная не определена в таблице.
    // Это может быть потому что:
    //  - вариант C: комбо-мастер нужен (Лайт 19-21, Медиум 13-14)
    //  - переходная просто не предусмотрена (Максимум, Стандарт-чёт)
    // Решение — не строим, без warning (это норма).
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2),
      section_index: ctx.sectionIndex,
      family_id: 'transition',
      rule_id: 'skip:no_transition_in_table',
      inputs: {
        density: effectiveDensity,
        sheet_type: sheetType,
        students_count: studentsCount,
        reason: 'row.transition_right === null',
      },
    });
    return;
  }

  // Шаг 4: жадная попытка построить правую страницу.
  // pageInstances.length нечётный → следующая страница right.
  const picked = tryPagePick(
    row.transition_right,
    ctx.available,
    ctx.bundle.mastersByName,
    'right',
  );

  if (!picked) {
    const attemptNames = row.transition_right.map((a) => a.master).join(' / ');
    ctx.warnings.push(
      `transition_skipped: правая страница (${attemptNames}) пропущена — ` +
        `недостаточно фото или нет мастеров`,
    );
    return;
  }

  // Шаг 5: bindings и pageInstance.
  const bindings = bindCommonPhotos(picked.master, ctx.input, ctx.available);
  decrementAvailable(ctx.available, picked.consumes);

  ctx.pageInstances.push({
    master_id: picked.master.id,
    bindings,
  });

  ctx.decisionTrace.push({
    spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: `table:${row.density}:${row.sheet_type}:${picked.master.name}`,
    inputs: {
      chosen_master: picked.master.name,
      category: picked.attempt.category,
      count: picked.attempt.count,
      position: 'right',
      students_count: studentsCount,
    },
  });
}

// ─── Логика выбора мастера на странице (копия из common-required.ts) ────────

interface PickedPage {
  master: SpreadTemplate;
  attempt: PageAttempt;
  consumes: SlotConsumes;
}

function tryPagePick(
  pageDesc: PageDescriptor,
  available: CommonPhotoCounts,
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  position: 'left' | 'right',
): PickedPage | null {
  for (let i = 0; i < pageDesc.length; i++) {
    const attempt = pageDesc[i];
    if (!hasEnoughPhotos(available, attempt.category, attempt.count)) continue;
    const effectiveName =
      position === 'right' ? pickRightVariant(attempt.master) : attempt.master;
    const master =
      mastersByName.get(effectiveName) ??
      (position === 'right' ? mastersByName.get(attempt.master) : undefined);
    if (!master) continue;
    const consumes: SlotConsumes = {};
    consumes[attempt.category] = attempt.count;
    return { master, attempt, consumes };
  }
  return null;
}

function hasEnoughPhotos(
  available: CommonPhotoCounts,
  category: CommonCategory,
  count: number,
): boolean {
  return available[category] >= count;
}
