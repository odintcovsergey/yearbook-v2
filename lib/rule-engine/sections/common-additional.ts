/**
 * Заполнение секции type='common_additional' для buildFromSectionStructure.
 *
 * РЭ.21.8.10: дополнительный общий раздел по эталонной таблице OkeyBook.
 *
 * Бизнес-контекст (Сергей, 19.05.2026):
 * Дополнительный общий раздел — платная допуслуга OkeyBook. Партнёр
 * предлагает родителям увеличить количество общих разворотов за доплату.
 * Engine ВСЕГДА верстает доп. раздел при наличии секции — это даёт
 * партнёру готовое превью для продажи родителям.
 *
 * Внешне страницы доп. раздела НЕ отличаются от обязательного — те же
 * мастера (J-Half, J-Quarter, J-Sixth-6 и т.д.), та же логика «или-или»
 * (см. common-required.ts).
 *
 * Управление количеством разворотов:
 * Секция принимает параметр `max_spreads` (или берётся из
 * `albums.common_section_max_spreads`). Если N=0 — секция не строится
 * (партнёр не купил допуслугу). Если N=2 — строится первые 4 страницы
 * из таблицы (2 разворота × 2 страницы).
 *
 * Особенность мягких листов:
 * В xlsx у мягких первая позиция доп. раздела — `-` (пропуск). Это
 * потому что у мягких обязательный раздел заканчивается на левой
 * странице, и доп должен начинаться с правой. В таблице это null
 * в additional_pages[0] — engine просто не строит страницу, переходит
 * к следующей.
 *
 * Логика выбора мастера на странице — переиспользуем tryPagePick из
 * common-required.ts (та же стратегия: жадно по приоритету попыток).
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

/**
 * Зеркальные пары мастеров. Левый → правый вариант на правой странице.
 * Та же логика что в common-required.ts.
 */
const MIRROR_RIGHT: Record<string, string> = {
  'J-Quarter-Left': 'J-Quarter-Right',
};

function pickRightVariant(masterName: string): string {
  return MIRROR_RIGHT[masterName] ?? masterName;
}

/**
 * Привести density пресета к расширенному Density для запроса в таблицу.
 * Та же логика что в common-required.ts (фолбэк для density=null через preset.id).
 */
function resolveDensityForTable(
  presetDensity: Density | null | undefined,
  presetId: string,
): Density | null {
  if (presetDensity) return presetDensity;
  if (presetId === 'maximum' || presetId === 'individual') return 'maximum';
  return null;
}

/**
 * Заполнение дополнительного общего раздела.
 *
 * @param ctx       — SectionFillContext (мутируется)
 * @param maxSpreads — макс. количество разворотов (из section или
 *                   album.common_section_max_spreads). 0 → секция не
 *                   строится.
 */
export function fillCommonAdditionalSection(
  ctx: SectionFillContext,
  maxSpreads: number,
): void {
  if (maxSpreads <= 0) {
    // Партнёр не купил допуслугу — секция не строится без warning
    // (это норма, не ошибка).
    return;
  }

  const presetDensity = ctx.bundle.preset.density;
  const sheetType = ctx.bundle.preset.sheet_type;
  const studentsCount = ctx.input.students.length;

  const effectiveDensity = resolveDensityForTable(
    presetDensity,
    ctx.bundle.preset.id,
  );

  if (!effectiveDensity || !sheetType) {
    ctx.warnings.push(
      `common_additional_no_density: preset.density=${String(
        presetDensity,
      )}, sheet_type=${String(sheetType)} — нельзя выбрать строку таблицы`,
    );
    return;
  }

  const row = pickRow(effectiveDensity, sheetType, studentsCount);
  if (!row) {
    ctx.warnings.push(
      `common_additional_no_row: нет строки таблицы для density=${effectiveDensity}, ` +
        `sheet_type=${sheetType}, students=${studentsCount}`,
    );
    return;
  }

  // Если у строки нет доп. раздела — не строим (это норма, не ошибка).
  if (row.additional_pages.length === 0) {
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-additional',
      rule_id: 'empty:by_table',
      inputs: {
        density: effectiveDensity,
        sheet_type: sheetType,
        students_count: studentsCount,
        reason: 'row.additional_pages empty in OkeyBook table',
      },
    });
    return;
  }

  // Лимит max_spreads × 2 = максимум страниц. Берём min от запрошенного
  // и того что есть в таблице.
  const maxPages = Math.min(maxSpreads * 2, row.additional_pages.length);

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const pageDesc = row.additional_pages[pageIdx];

    // null = в таблице на этой позиции `-` (пропуск страницы). Например
    // у мягких 1L = null. Просто не строим, переходим к следующей.
    if (pageDesc === null) {
      ctx.decisionTrace.push({
        spread_index: Math.floor(ctx.pageInstances.length / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-additional',
        rule_id: `skip:null_in_table:${pageIdx}`,
        inputs: {
          page_index_in_section: pageIdx,
          reason: 'null in additional_pages (table has `-` for this position)',
        },
      });
      continue;
    }

    const pageIndex = ctx.pageInstances.length;
    const position: 'left' | 'right' = pageIndex % 2 === 0 ? 'left' : 'right';

    const picked = tryPagePick(
      pageDesc,
      ctx.available,
      ctx.bundle.mastersByName,
      position,
    );

    if (!picked) {
      const attemptNames = pageDesc.map((a) => a.master).join(' / ');
      ctx.warnings.push(
        `common_additional_page_skipped: страница #${pageIdx + 1} ` +
          `(${attemptNames}) пропущена — недостаточно фото или нет мастеров`,
      );
      ctx.decisionTrace.push({
        spread_index: Math.floor(pageIndex / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-additional',
        rule_id: `skip:${pageIdx}`,
        inputs: {
          page_index_in_section: pageIdx,
          attempts: pageDesc.map((a) => ({
            master: a.master,
            category: a.category,
            count: a.count,
          })),
          position,
        },
      });
      continue;
    }

    // Bindings ДО decrement available (cursor-логика).
    const bindings = bindCommonPhotos(picked.master, ctx.input, ctx.available);
    decrementAvailable(ctx.available, picked.consumes);

    ctx.pageInstances.push({
      master_id: picked.master.id,
      bindings,
    });

    ctx.decisionTrace.push({
      spread_index: Math.floor(pageIndex / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-additional',
      rule_id: `table:${row.density}:${row.sheet_type}:${picked.master.name}`,
      inputs: {
        page_index_in_section: pageIdx,
        chosen_master: picked.master.name,
        category: picked.attempt.category,
        count: picked.attempt.count,
        position,
        students_count: studentsCount,
      },
    });
  }
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
      position === 'right'
        ? pickRightVariant(attempt.master)
        : attempt.master;
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
