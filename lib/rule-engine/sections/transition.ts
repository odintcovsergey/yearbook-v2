/**
 * РЭ.37.2.b — переходный раздел с использованием classifyTransitionLayout.
 *
 * АРХИТЕКТУРА (по решению Сергея от 24.05.2026):
 *
 * Раздел учеников (sections/students.ts) — «Лёша» — кладёт все страницы
 * как обычно, включая хвостовую (с placeholder-padding если неполная).
 * Этот код менять НЕ нужно (он стабильно работает в проде).
 *
 * Переходный раздел (sections/transition.ts) — «Боря» — приходит после
 * и решает что делать:
 *
 *   1. Если в шаблоне партнёром явно задан master_name (legacy РЭ.32) →
 *      использовать его. Поведение не отличается от прежнего РЭ.32.
 *
 *   2. Если mode='okeybook_default' (или mode не задан в новых пресетах
 *      без master_name) → применять стандартную логику OkeyBook:
 *       • определить комплектацию по последней странице students
 *       • вызвать classifyTransitionLayout для расчёта раскладки
 *       • если tail_page='combo' → POP последней (хвостовой) страницы
 *         students и PUSH combo-мастер с tail портретами + (M-tail)
 *         скрытых слотов + classphoto снизу
 *       • если общая длина pageInstances осталась нечётной → PUSH
 *         закрывающую страницу через J-цепочку (half→sixth→full)
 *
 *   3. Если mode='custom' → партнёр задал сценарий вручную. Реализация
 *      в РЭ.37.2.c (этот коммит — стаб с warning).
 *
 * ПОЗИЦИИ L/R: определяются по чётности индекса в pageInstances.
 *   Index 0 = page 1 (левая, нечётная по типографии)
 *   Index 1 = page 2 (правая, чётная)
 *   Index N: L если N % 2 == 0, R если N % 2 == 1
 *
 * ПОИСК ЗЕРКАЛЬНЫХ -RIGHT ВАРИАНТОВ. Combo-мастера в InDesign по
 * решению Сергея делаются ВСЕГДА в двух версиях: J-Combined-Tail-4 (для
 * левой страницы) и J-Combined-Tail-4-Right (для правой). Поиск:
 *   • L (index чёт) → ищем base, fallback на -Right если base нет
 *   • R (index нечёт) → ищем -Right, fallback на base
 * Аналогично для J-Half / J-Full / J-Collage-6 — там зеркальные варианты
 * могут отсутствовать (симметричные мастера), движок справится с base.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type { CommonPhotoCounts, SlotConsumes } from '../slot-chains';
import { bindCommonPhotos, decrementAvailable } from './common';
import {
  classifyTransitionLayout,
  type Complectation,
  type TransitionLayout,
} from '../transition-cases';
import { detectComplectationFromLastPage } from '../detect-complectation';
import { pushCombinedTailPage } from './students';
import type { SectionFillContext } from './shared';
import type { SectionStructureEntry } from '../types';

// ─── J-цепочка (закрывающие страницы переходного раздела) ───────────────

/**
 * Категории для J-цепочки (правая закрывающая страница). По решению
 * Сергея от 24.05.2026 порядок — half → sixth → full, выбор первой
 * категории с достаточным количеством фото в пуле (не жёсткий
 * приоритет — пропускаем недоступные).
 *
 * РЭ.32 использовала порядок (full, half, quarter, sixth). Новый порядок
 * убирает quarter (он используется только в common_required) и ставит
 * half первым — по умолчанию OkeyBook для переходного.
 */
type JCategory = 'half_class' | 'sixth' | 'full_class';

const J_PHOTO_COUNT: Record<JCategory, number> = {
  half_class: 2,
  sixth: 6,
  full_class: 1,
};

const J_PRIORITY_OKEYBOOK_DEFAULT: JCategory[] = [
  'half_class',
  'sixth',
  'full_class',
];

// ─── Хелперы для классификации мастеров (для legacy и анализа) ──────────

type LegacyCategory = 'full_class' | 'half_class' | 'quarter' | 'sixth';

const LEGACY_PHOTO_COUNT: Record<LegacyCategory, number> = {
  full_class: 1,
  half_class: 2,
  quarter: 4,
  sixth: 6,
};

/**
 * Определить какая J-категория «подходит» мастеру: по его placeholder'ам.
 * Используется legacy-веткой (master_name явно задан) для решения,
 * сколько фото мастер ожидает.
 *
 * Возвращает null если мастер — не чистый J-вариант (содержит portrait
 * слоты учеников/учителей или ничего из J-набора).
 */
function classifyMasterCategory(master: SpreadTemplate): LegacyCategory | null {
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
      return null;
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
 * Найти первый чистый J-мастер заданной категории, с зеркалом для R.
 * Поведение РЭ.32 — оставлено для legacy ветки master_name.
 */
function findCommonMasterForCategory(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  category: LegacyCategory,
  position: 'left' | 'right',
): SpreadTemplate | null {
  for (const m of Array.from(mastersByName.values())) {
    if (m.name.endsWith('-Right')) continue;
    const cat = classifyMasterCategory(m);
    if (cat !== category) continue;
    if (position === 'right') {
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
 * РЭ.37.2.b: поиск combo-мастера по базовому имени с учётом позиции.
 * Combo всегда асимметричен → ищем -Right для R, fallback на base.
 *
 * Возвращает null если ни base, ни -Right не найдены — это сигнал
 * что combo в template_set отсутствует (партнёр не нарисовал его в
 * InDesign), нужно сгенерировать warning.
 */
function findComboMaster(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  baseName: string,
  position: 'left' | 'right',
): SpreadTemplate | null {
  if (position === 'right') {
    const right = mastersByName.get(`${baseName}-Right`);
    if (right) return right;
    // fallback на base — это норма, если мастер симметричный
    return mastersByName.get(baseName) ?? null;
  }
  return mastersByName.get(baseName) ?? null;
}

// ─── Главная экспортная функция ─────────────────────────────────────────

/**
 * Заполнение секции type='transition'.
 *
 * sectionEntry — элемент section_structure (форма transition: либо
 * legacy master_name, либо новые mode='okeybook_default' / 'custom').
 */
export function fillTransitionSection(
  ctx: SectionFillContext,
  sectionEntry: Extract<SectionStructureEntry, { type: 'transition' }>,
): void {
  // ─── РЭ.37.2.c: явный custom-сценарий партнёра ─────────────────────
  if (sectionEntry.mode === 'custom') {
    fillCustomMode(ctx, sectionEntry);
    return;
  }

  // ─── Legacy РЭ.32 (master_name задан) ──────────────────────────────
  // Партнёр явно зафиксировал мастер. Используем РЭ.32 ветку без
  // изменений (классификатор не применяется).
  const masterName =
    'master_name' in sectionEntry ? sectionEntry.master_name : null;
  if (masterName) {
    fillLegacyMasterName(ctx, masterName);
    return;
  }

  // ─── По умолчанию: okeybook_default ────────────────────────────────
  fillOkeybookDefault(ctx);
}

// ─── Ветка 0: РЭ.37.2.c — кастомный сценарий партнёра ───────────────────

/**
 * Заполнение transition в режиме mode='custom'. Партнёр через UI
 * (РЭ.37.6) явно задал combo-мастера для двух кейсов:
 *
 *   tail_left:  combo на L + закрывающий мастер на R   (хвост сел на L)
 *   tail_right: combo на R                              (хвост сел на R)
 *
 * Engine определяет КАКОЙ из двух сценариев применить по чётности
 * числа полных страниц students:
 *
 *   full_pages чёт + tail > 0 → tail_left  (хвост на L нового разворота)
 *   full_pages нечёт + tail > 0 → tail_right (хвост на R того же разворота)
 *
 * Custom применяется ТОЛЬКО для combo-кейсов (tail ≤ M). В остальных
 * ситуациях — grid_padded (tail > M), tail = 0 + full нечёт (нужно
 * закрыть последний полный разворот), и т.д. — engine падает на
 * fillOkeybookDefault. Это разумно с точки зрения UX: партнёр в UI
 * настраивает только combo-кейсы, всё остальное идёт по стандартной
 * логике OkeyBook. (Если нужна полная переопределяемость — добавим
 * новые поля в TransitionCustomScenario в будущей фазе.)
 */
function fillCustomMode(
  ctx: SectionFillContext,
  sectionEntry: Extract<SectionStructureEntry, { type: 'transition' }>,
): void {
  // 1. Базовая валидация
  if (!sectionEntry.custom) {
    ctx.warnings.push(
      'transition_custom_missing: mode=custom, но поле custom отсутствует — фолбэк на okeybook_default',
    );
    fillOkeybookDefault(ctx);
    return;
  }
  const custom = sectionEntry.custom;

  // 2. Определение комплектации и расчёт раскладки (так же как в okeybook_default).
  const lastPage = ctx.pageInstances[ctx.pageInstances.length - 1];
  const complectation = detectComplectationFromLastPage(
    lastPage?.master_id,
    ctx.bundle.mastersByName,
  );
  if (!complectation) {
    ctx.warnings.push(
      'transition_complectation_unknown (custom): не удалось определить комплектацию — фолбэк на okeybook_default',
    );
    fillOkeybookDefault(ctx);
    return;
  }

  const studentsCount = ctx.input.students.length;
  const layout = classifyTransitionLayout(complectation, studentsCount);

  ctx.decisionTrace.push({
    spread_index: Math.floor(ctx.pageInstances.length / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: 'custom:classify',
    inputs: {
      complectation,
      students_count: studentsCount,
      full_pages: layout.full_pages,
      tail: layout.tail,
      tail_page: layout.tail_page,
    },
  });

  // 3. Custom применяется только для combo-кейсов.
  if (layout.tail_page !== 'combo' || layout.combo_capacity === null) {
    // Не combo → fallback на дефолт (J-цепочка закрытия / off).
    fillOkeybookDefault(ctx);
    return;
  }

  // 4. Выбор сценария: чётность full_pages → где сел хвост.
  const tailIsOnLeft = layout.full_pages % 2 === 0;
  if (tailIsOnLeft) {
    applyCustomTailLeft(ctx, custom, layout, complectation);
  } else {
    applyCustomTailRight(ctx, custom, layout, complectation);
  }
}

/**
 * Сценарий A — хвост сел на L нового разворота:
 *   POP хвостовой страницы students
 *   PUSH custom.tail_left.left как combo на L (с tail портретами + __hidden__ + classphoto)
 *   PUSH custom.tail_left.right (или -Right) как закрывающий мастер на R
 */
function applyCustomTailLeft(
  ctx: SectionFillContext,
  custom: NonNullable<
    Extract<SectionStructureEntry, { type: 'transition' }>['custom']
  >,
  layout: TransitionLayout,
  complectation: Complectation,
): void {
  // Восстановить available если хвостовая students-страница была combined_tail.
  const popped = ctx.pageInstances.pop();
  if (!popped) {
    ctx.warnings.push(
      'transition_custom_no_tail_page (tail_left): pageInstances пуст — пропуск',
    );
    return;
  }
  const hadClassphoto =
    typeof popped.bindings?.classphotoframe === 'string' &&
    popped.bindings.classphotoframe.length > 0;
  if (hadClassphoto) {
    ctx.available.full_class += 1;
  }

  // Combo на L (позиция чёт = L → base без -Right).
  const leftName = custom.tail_left.left.master_name;
  const leftMaster = ctx.bundle.mastersByName.get(leftName);
  if (!leftMaster) {
    // Если custom-мастер не найден — отложили POP, нужно вернуть страницу
    // обратно, чтобы хотя бы остался хвост students. Симметрично с
    // hadClassphoto reversal.
    ctx.pageInstances.push(popped);
    if (hadClassphoto) ctx.available.full_class -= 1;
    ctx.warnings.push(
      `transition_custom_master_missing (tail_left.left): '${leftName}' не найден в template_set`,
    );
    return;
  }

  const tailStudents = ctx.input.students.slice(
    ctx.input.students.length - layout.tail,
  );

  const density: 'mini' | 'light' | 'medium' =
    complectation === 'mini' || complectation === 'light' || complectation === 'medium'
      ? complectation
      : 'mini';
  pushCombinedTailPage(
    ctx,
    leftMaster,
    tailStudents,
    layout.combo_capacity!,
    density,
  );

  ctx.decisionTrace.push({
    spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: `custom:tail_left:combo:${leftMaster.name}`,
    inputs: {
      master_name: leftMaster.name,
      tail_students: layout.tail,
      combo_capacity: layout.combo_capacity,
    },
  });

  // Закрывающий мастер на R (custom.tail_left.right). Ищем -Right
  // вариант, fallback на base.
  const rightBaseName = custom.tail_left.right.master_name;
  const rightMaster =
    ctx.bundle.mastersByName.get(`${rightBaseName}-Right`) ??
    ctx.bundle.mastersByName.get(rightBaseName);
  if (!rightMaster) {
    ctx.warnings.push(
      `transition_custom_master_missing (tail_left.right): '${rightBaseName}' не найден в template_set`,
    );
    return;
  }

  // Размещаем как J-page. classifyMasterCategory отдаёт корректную
  // category (half_class / sixth / full_class / quarter) — для всех
  // консумируем правильное количество фото.
  const category = classifyMasterCategory(rightMaster);
  if (category === null) {
    ctx.warnings.push(
      `transition_custom_master_invalid (tail_left.right): '${rightMaster.name}' ` +
        `не имеет J-категории placeholder'ов`,
    );
    return;
  }
  const need = LEGACY_PHOTO_COUNT[category];
  if (ctx.available[category] < need) {
    ctx.warnings.push(
      `transition_custom_skipped (tail_left.right): '${rightMaster.name}' ` +
        `нужно ${need} фото ${category}, доступно ${ctx.available[category]}`,
    );
    return;
  }
  placeJChainPage(
    ctx,
    rightMaster,
    category,
    'right',
    ctx.pageInstances.length,
  );
}

/**
 * Сценарий B — хвост сел на R того же разворота:
 *   POP хвостовой страницы students
 *   PUSH custom.tail_right.right (или -Right) как combo на R
 *
 * Закрывающий мастер на L НЕ нужен — там уже лежит последняя полная
 * сетка students.
 */
function applyCustomTailRight(
  ctx: SectionFillContext,
  custom: NonNullable<
    Extract<SectionStructureEntry, { type: 'transition' }>['custom']
  >,
  layout: TransitionLayout,
  complectation: Complectation,
): void {
  const popped = ctx.pageInstances.pop();
  if (!popped) {
    ctx.warnings.push(
      'transition_custom_no_tail_page (tail_right): pageInstances пуст — пропуск',
    );
    return;
  }
  const hadClassphoto =
    typeof popped.bindings?.classphotoframe === 'string' &&
    popped.bindings.classphotoframe.length > 0;
  if (hadClassphoto) {
    ctx.available.full_class += 1;
  }

  // Combo на R: ищем -Right, fallback на base.
  const baseName = custom.tail_right.right.master_name;
  const comboMaster =
    ctx.bundle.mastersByName.get(`${baseName}-Right`) ??
    ctx.bundle.mastersByName.get(baseName);
  if (!comboMaster) {
    ctx.pageInstances.push(popped);
    if (hadClassphoto) ctx.available.full_class -= 1;
    ctx.warnings.push(
      `transition_custom_master_missing (tail_right.right): '${baseName}' не найден в template_set`,
    );
    return;
  }

  const tailStudents = ctx.input.students.slice(
    ctx.input.students.length - layout.tail,
  );
  const density: 'mini' | 'light' | 'medium' =
    complectation === 'mini' || complectation === 'light' || complectation === 'medium'
      ? complectation
      : 'mini';
  pushCombinedTailPage(
    ctx,
    comboMaster,
    tailStudents,
    layout.combo_capacity!,
    density,
  );

  ctx.decisionTrace.push({
    spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: `custom:tail_right:combo:${comboMaster.name}`,
    inputs: {
      master_name: comboMaster.name,
      tail_students: layout.tail,
      combo_capacity: layout.combo_capacity,
    },
  });
}

// ─── Ветка 1: новая логика OkeyBook ─────────────────────────────────────

function fillOkeybookDefault(ctx: SectionFillContext): void {
  // 1. Определить комплектацию по последней положенной странице.
  const lastPage = ctx.pageInstances[ctx.pageInstances.length - 1];
  const complectation = detectComplectationFromLastPage(
    lastPage?.master_id,
    ctx.bundle.mastersByName,
  );

  // Если students-секции вообще не было (например, в шаблоне нет students)
  // или последний мастер неопознан — просто пропускаем с warning. Без
  // пустых страниц.
  if (!complectation) {
    if (ctx.pageInstances.length % 2 === 1) {
      ctx.warnings.push(
        'transition_complectation_unknown: не удалось определить комплектацию ' +
          'по последней странице — переходный пропущен (висит правая страница)',
      );
    }
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2),
      section_index: ctx.sectionIndex,
      family_id: 'transition',
      rule_id: 'skip:complectation_unknown',
      inputs: { last_master_id: lastPage?.master_id ?? null },
    });
    return;
  }

  const studentsCount = ctx.input.students.length;
  const layout = classifyTransitionLayout(complectation, studentsCount);

  ctx.decisionTrace.push({
    spread_index: Math.floor(ctx.pageInstances.length / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: 'okeybook_default:classify',
    inputs: {
      complectation,
      students_count: studentsCount,
      full_pages: layout.full_pages,
      tail: layout.tail,
      tail_page: layout.tail_page,
      closing_page: layout.closing_page,
    },
  });

  // 2. Шаг А: если tail_page='combo' — заменить хвостовую страницу
  //    students на combo-мастер. POP + PUSH.
  if (
    layout.tail_page === 'combo' &&
    layout.combo_master_base !== null &&
    layout.combo_capacity !== null
  ) {
    const replaced = tryReplaceTailWithCombo(ctx, layout, complectation);
    if (!replaced) {
      // Combo-мастер не найден в template_set (партнёр не нарисовал).
      // Warning уже добавлен внутри try. Продолжаем — может быть J на R
      // всё ещё поможет.
    }
  }

  // 3. Шаг B: если общая длина после возможной замены нечётная — нужна
  //    закрывающая страница через J-цепочку на правой.
  if (ctx.pageInstances.length % 2 === 1) {
    tryJChainClosing(ctx);
  }
}

/**
 * Шаг А — заменить хвостовую (неполную) страницу students-секции на
 * combo-мастер.
 *
 * Алгоритм:
 *   1. Найти combo-мастер с учётом позиции (где сейчас лежит хвост).
 *   2. Прочитать bindings последней страницы — извлечь учеников хвоста
 *      и фото full_class (если оно там было — для случая combined_tail).
 *   3. POP последней страницы.
 *   4. PUSH combo-мастера через pushCombinedTailPage (из students.ts).
 *      Это автоматически даст __hidden__ для (M - tail) слотов + classphoto.
 *
 * Returns true если замена прошла успешно.
 */
function tryReplaceTailWithCombo(
  ctx: SectionFillContext,
  layout: TransitionLayout,
  complectation: Complectation,
): boolean {
  if (
    layout.combo_master_base === null ||
    layout.combo_capacity === null ||
    layout.tail === 0
  ) {
    return false;
  }

  // Хвостовая страница на текущей позиции pageInstances.length - 1.
  const tailIndex = ctx.pageInstances.length - 1;
  if (tailIndex < 0) {
    ctx.warnings.push(
      'transition_no_tail_page: ожидалась хвостовая страница students, но pageInstances пуст',
    );
    return false;
  }

  // Позиция combo = там же, где была хвостовая страница.
  const position: 'left' | 'right' = tailIndex % 2 === 0 ? 'left' : 'right';

  const combo = findComboMaster(
    ctx.bundle.mastersByName,
    layout.combo_master_base,
    position,
  );
  if (!combo) {
    ctx.warnings.push(
      `transition_combo_master_missing: '${layout.combo_master_base}' ` +
        `(или -Right) не найден в template_set — хвостовая страница ` +
        `students оставлена как есть`,
    );
    return false;
  }

  // Берём последних `tail` учеников из входного списка — они на
  // хвостовой странице. (students.ts размещает учеников по порядку
  // через bindGridStudents, см. lib/rule-engine/sections/students.ts.)
  const tailStudents = ctx.input.students.slice(
    ctx.input.students.length - layout.tail,
  );

  // Хвостовая страница students могла быть combined_tail (с classphoto)
  // или обычная N-Grid (без). Если combined_tail — full_class уже был
  // потреблён внутри students.ts. Чтобы pushCombinedTailPage снова
  // взял full_class, нам нужно либо НЕ декрементить (восстановить
  // available.full_class), либо использовать другую функцию.
  //
  // Простое решение: если хвостовая страница содержала classphotoframe
  // (combined_tail) — мы её замещаем тем же мастером логически
  // (combo тоже содержит classphoto), full_class остаётся
  // декрементированным правильно. POP не вернёт фото обратно. Чтобы
  // pushCombinedTailPage не потребил вторую фотку, нужно вернуть 1
  // в available перед вызовом (но только если оно было потреблено).
  //
  // Проверяем bindings popнутой страницы — если там есть classphotoframe,
  // фото уже было потреблено и его надо вернуть, чтобы pushCombinedTailPage
  // не съел вторую копию.
  const popped = ctx.pageInstances.pop()!;
  const hadClassphoto =
    typeof popped.bindings?.classphotoframe === 'string' &&
    popped.bindings.classphotoframe.length > 0;
  if (hadClassphoto) {
    ctx.available.full_class += 1;
  }

  // pushCombinedTailPage ждёт slotsPerPage = capacity мастера (M) и
  // students[] длиной от 1 до M.
  // density — используется только в decisionTrace.rule_id как метка.
  // Для combo это совпадает с грид-комплектацией (mini/light/medium).
  // Combo не определён для standard/universal/maximum — туда tryReplace
  // не дойдёт (combo_capacity=null), но для type safety ставим fallback.
  const density: 'mini' | 'light' | 'medium' =
    complectation === 'mini' || complectation === 'light' || complectation === 'medium'
      ? complectation
      : 'mini';
  pushCombinedTailPage(
    ctx,
    combo,
    tailStudents,
    layout.combo_capacity,
    density,
  );

  ctx.decisionTrace.push({
    spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: `combo_replace:${combo.name}`,
    inputs: {
      combo_master: combo.name,
      tail_students: layout.tail,
      combo_capacity: layout.combo_capacity,
      position,
      previous_classphoto_returned: hadClassphoto,
    },
  });

  return true;
}

/**
 * Шаг B — закрывающая страница через J-цепочку.
 * Идём по J_PRIORITY_OKEYBOOK_DEFAULT, для каждой категории проверяем
 * доступность фото И наличие мастера в template_set. Первое совпадение
 * — кладём, выходим.
 */
function tryJChainClosing(ctx: SectionFillContext): void {
  const pageIndex = ctx.pageInstances.length;
  const position: 'left' | 'right' = pageIndex % 2 === 0 ? 'left' : 'right';

  for (const category of J_PRIORITY_OKEYBOOK_DEFAULT) {
    const need = J_PHOTO_COUNT[category];
    if (ctx.available[category] < need) continue;

    // J-Half / J-Collage-6 / J-Full ищем через классификатор мастеров.
    const legacyCat: LegacyCategory = category;
    const master = findCommonMasterForCategory(
      ctx.bundle.mastersByName,
      legacyCat,
      position,
    );
    if (!master) continue;

    placeJChainPage(ctx, master, legacyCat, position, pageIndex);
    return;
  }

  ctx.warnings.push(
    'transition_skipped: нет фото ни одной J-категории (half/sixth/full) ' +
      'или подходящих мастеров для закрытия переходного разворота',
  );
  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: 'skip:no_j_master_or_photos',
    inputs: { available: { ...ctx.available } },
  });
}

// ─── Ветка 2: legacy РЭ.32 (master_name явно задан) ─────────────────────

function fillLegacyMasterName(ctx: SectionFillContext, masterName: string): void {
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
  const master = ctx.bundle.mastersByName.get(masterName);
  if (!master) {
    ctx.warnings.push(
      `transition_master_missing: '${masterName}' не найден в template_set, ` +
        `применяю встроенное правило`,
    );
    // fallback на новую логику okeybook_default
    fillOkeybookDefault(ctx);
    return;
  }
  const category = classifyMasterCategory(master);
  if (category === null) {
    ctx.warnings.push(
      `transition_master_invalid: '${masterName}' не имеет J-категории placeholder'ов`,
    );
    return;
  }
  const need = LEGACY_PHOTO_COUNT[category];
  const have = ctx.available[category];
  if (have < need) {
    ctx.warnings.push(
      `transition_skipped: '${masterName}' (нужно ${need} фото ${category}, ` +
        `доступно ${have})`,
    );
    return;
  }
  placeJChainPage(ctx, master, category, 'right', pageIndex);
}

// ─── Общая функция размещения J-страницы ────────────────────────────────

function placeJChainPage(
  ctx: SectionFillContext,
  master: SpreadTemplate,
  category: LegacyCategory,
  position: 'left' | 'right',
  pageIndex: number,
): void {
  const bindings = bindCommonPhotos(master, ctx.input, ctx.available);

  const consumes: SlotConsumes = {};
  consumes[category] = LEGACY_PHOTO_COUNT[category];
  decrementAvailable(ctx.available, consumes);

  ctx.pageInstances.push({
    master_id: master.id,
    bindings,
  });

  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: `j_chain:${category}:${master.name}`,
    inputs: {
      category,
      count: LEGACY_PHOTO_COUNT[category],
      master_name: master.name,
      position,
    },
  });
}
