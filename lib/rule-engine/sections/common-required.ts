/**
 * Заполнение секции type='common_required' для buildFromSectionStructure.
 *
 * РЭ.21.8.9: обязательный общий раздел по эталонной таблице OkeyBook.
 *
 * В отличие от type='common' (manual/auto) — здесь партнёр НЕ задаёт
 * параметры. Engine сам:
 *   1. Берёт `preset.density` × `preset.sheet_type` × `input.students.length`.
 *   2. Через pickRow() находит строку таблицы OkeyBook.
 *   3. Для каждой страницы в row.pages идёт по массиву попыток
 *      (PageAttempt[]) и берёт первую где хватает фото в пуле.
 *   4. Заполняет bindings placeholder-driven маппингом
 *      (общим с common.ts через bindCommonPhotos).
 *
 * Особые случаи:
 *   - Если pickRow вернул null — нет подходящей строки в таблице (например
 *     для пресета без density). Warning + секция пропускается.
 *   - Если row.pages пустой (Мини плотные 25+) — секция строится в 0
 *     страниц без warning (это норма по таблице).
 *   - Если для конкретной страницы ни одна попытка не подошла —
 *     `slot_skipped` warning, страница пропускается, но след страницы
 *     обрабатываются (cursor общих фото не съезжает).
 *
 * Зеркальные мастера J-Quarter-Left/-Right
 * ────────────────────────────────────────
 * В таблице хранится только Left-вариант (`J-Quarter-Left`). На правой
 * странице разворота имя автоматически заменяется на Right-вариант
 * через `pickRightVariant()`. Это упрощает таблицу и не дублирует строки.
 *
 * Bindings заполнения общими фото — переиспользуем `bindCommonPhotos` из
 * common.ts (она placeholder-driven и не зависит от способа выбора мастера).
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { CommonPhotoCounts, SlotConsumes } from '../slot-chains';
import type { Density } from '../types';
import { pickRow } from '../album-structure-okeybook';
import type {
  CommonCategory,
  PageAttempt,
  TableRow,
} from '../album-structure-okeybook';
import { bindCommonPhotos, decrementAvailable } from './common';
import type { SectionFillContext } from './shared';

/**
 * Зеркальные пары мастеров. Когда страница позиционирована справа и в
 * описании страницы упомянут Left-мастер из этого мапа — заменяем на Right.
 */
const MIRROR_RIGHT: Record<string, string> = {
  'J-Quarter-Left': 'J-Quarter-Right',
};

function pickRightVariant(masterName: string): string {
  return MIRROR_RIGHT[masterName] ?? masterName;
}

/**
 * Привести density пресета (PresetDensity) к расширенному Density для
 * запроса в таблицу. Для Максимум/Индивидуальной у presets.density сейчас
 * null (см. РЭ.20.5), но в section_structure обычно явно указан тип
 * комплектации через имя пресета. Без отдельной колонки в БД мы не можем
 * точно различить null=Максимум vs null=Индивидуальная — оба сейчас
 * мапятся на 'maximum' (решение Сергея 19.05.2026).
 *
 * В будущем если presets.density расширится включая 'maximum' (или появится
 * отдельная колонка `category`), эта функция перепишется тривиально.
 */
function resolveDensityForTable(
  presetDensity: Density | null | undefined,
  presetId: string,
): Density | null {
  if (presetDensity) return presetDensity;
  // Фолбэк: pickRow по имени пресета. Для пресетов 'maximum' и 'individual'
  // используем 'maximum' (см. решение Сергея 19.05.2026).
  if (presetId === 'maximum' || presetId === 'individual') return 'maximum';
  return null;
}

export function fillCommonRequiredSection(ctx: SectionFillContext): void {
  const presetDensity = ctx.bundle.preset.density;
  const sheetType = ctx.bundle.preset.sheet_type;
  const studentsCount = ctx.input.students.length;

  const effectiveDensity = resolveDensityForTable(
    presetDensity,
    ctx.bundle.preset.id,
  );

  if (!effectiveDensity || !sheetType) {
    ctx.warnings.push(
      `common_required_no_density: preset.density=${String(
        presetDensity,
      )}, sheet_type=${String(sheetType)} — нельзя выбрать строку таблицы`,
    );
    return;
  }

  const row = pickRow(effectiveDensity, sheetType, studentsCount);
  if (!row) {
    ctx.warnings.push(
      `common_required_no_row: нет строки таблицы для density=${effectiveDensity}, ` +
        `sheet_type=${sheetType}, students=${studentsCount}`,
    );
    return;
  }

  // Пустой массив страниц — таблица говорит «обязательного раздела нет».
  // Это норма для Мини плотные 25+. Декретируем decision_trace для
  // отладки, но никаких страниц и warnings.
  if (row.pages.length === 0) {
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-required',
      rule_id: 'empty:by_table',
      inputs: {
        density: effectiveDensity,
        sheet_type: sheetType,
        students_count: studentsCount,
        reason: 'row.pages empty in OkeyBook table',
      },
    });
    return;
  }

  // Заполняем страницы по описанию.
  for (let pageIdx = 0; pageIdx < row.pages.length; pageIdx++) {
    const pageDesc = row.pages[pageIdx];
    const pageIndex = ctx.pageInstances.length;
    const position: 'left' | 'right' = pageIndex % 2 === 0 ? 'left' : 'right';

    const picked = tryPagePick(
      pageDesc,
      ctx.available,
      ctx.bundle.mastersByName,
      position,
    );

    if (!picked) {
      // Ни одна попытка не подошла (мало фото или мастеров нет в template_set).
      const attemptNames = pageDesc.map((a) => a.master).join(' / ');
      ctx.warnings.push(
        `common_required_page_skipped: страница #${pageIdx + 1} ` +
          `(${attemptNames}) пропущена — недостаточно фото или нет мастеров`,
      );
      ctx.decisionTrace.push({
        spread_index: Math.floor(pageIndex / 2),
        section_index: ctx.sectionIndex,
        family_id: 'common-required',
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

    // Bindings ДО decrement available (cursor-логика как в common.ts).
    const bindings = bindCommonPhotos(picked.master, ctx.input, ctx.available);
    decrementAvailable(ctx.available, picked.consumes);

    ctx.pageInstances.push({
      master_id: picked.master.id,
      bindings,
    });

    ctx.decisionTrace.push({
      spread_index: Math.floor(pageIndex / 2),
      section_index: ctx.sectionIndex,
      family_id: 'common-required',
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

// ─── Логика выбора мастера на странице ──────────────────────────────────────

interface PickedPage {
  master: SpreadTemplate;
  attempt: PageAttempt;
  consumes: SlotConsumes;
}

/**
 * Перебрать попытки описания страницы. Вернуть первую где (а) хватает фото
 * в категории и (б) мастер существует в template_set.
 *
 * Зеркальный выбор: если попытка содержит мастер из MIRROR_RIGHT и position='right' —
 * подменяем имя на правый вариант. Если правый мастер отсутствует — пробуем
 * левый как фолбэк (на всякий случай).
 */
function tryPagePick(
  pageDesc: PageAttempt[],
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
    const master = mastersByName.get(effectiveName)
      // Фолбэк на левый вариант если правый отсутствует в template_set.
      ?? (position === 'right' ? mastersByName.get(attempt.master) : undefined);
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
