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
 * ПОЗИЦИИ L/R: определяются по ФИЗИЧЕСКОЙ странице через positionOfIndex().
 *   Для layflat (sheet_type='hard'): pageInstances[0] = physical page 1 = L.
 *   Для soft   (sheet_type='soft'): pageInstances[0] = physical page 2 = R
 *     (page 1 у мягкого переплёта физически отсутствует — это лист обложки,
 *     первая внутренняя страница сразу правая первого разворота).
 *
 *   Формулы:
 *     hard:  index N → physical page (N+1) → L iff N%2==0
 *     soft:  index N → physical page (N+2) → L iff N%2==1   (инвертировано)
 *
 *   Тот же сдвиг влияет на «висит ли правая страница» (hasVacantRight) —
 *   для soft нужна закрывающая правая при ЧЁТНОМ pageInstances.length,
 *   для hard — при НЕЧЁТНОМ.
 *
 *   РЭ.37.3.b (25.05.2026): до этой даты transition работал в layflat-логике
 *   для обоих типов листов, и для soft хвостовые развороты не закрывались.
 *
 * ПОИСК ЗЕРКАЛЬНЫХ -RIGHT ВАРИАНТОВ. Combo-мастера в InDesign по
 * решению Сергея делаются ВСЕГДА в двух версиях: J-Combined-Tail-4 (для
 * левой страницы) и J-Combined-Tail-4-Right (для правой). Поиск:
 *   • L (positionOfIndex==left)  → ищем base, fallback на -Right если base нет
 *   • R (positionOfIndex==right) → ищем -Right, fallback на base
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
import { pushCombinedTailPage, pushGridPage } from './students';
import type { SectionFillContext } from './shared';
import type { SectionStructureEntry, TransitionScenario } from '../types';

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

// РЭ.37.3.b.2 (25.05.2026): порядок sixth → half_class → full_class.
//
// Раньше было half → sixth → full (порядок задал Сергей 24.05.2026 в РЭ.37.2),
// но в практике оказалось что closing-страница transition'а конкурирует с
// common_required за фото half_class: партнёры загружают много фото sixth
// под коллажи (обычно ≥6), а half_class и full_class — единицы. После
// transition closing на J-Half пул half_class опустошался, и последняя
// страница общего раздела (тоже часто J-Half) пропускалась с warning.
//
// sixth-first снижает этот конфликт: closing transition'а берёт J-Collage-6
// (4 sixth-фото у J-Collage-6, или 6 у Collage-6 в зависимости от мастера),
// half_class остаётся для общего раздела, full_class остаётся как последний
// fallback. См. Тест2 case (25.05.2026, JSON layout_id 1d2387c6).
const J_PRIORITY_OKEYBOOK_DEFAULT: JCategory[] = [
  'sixth',
  'half_class',
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
 * РЭ.37.3.b: helpers для физической чётности страниц с учётом sheet_type.
 *
 * Engine работает с pageInstances как с flat-списком, индексация начинается
 * с 0 для первой записи. Физическая страница (1-based, та что номер на
 * обложке/типографском листе) зависит от типа переплёта:
 *
 *   • layflat (hard): physical page = index + 1
 *     (pageInstances[0] = page 1 = LEFT первого разворота)
 *
 *   • soft: physical page = index + 2
 *     (page 1 у soft — обложка/forzac, она не входит в pageInstances;
 *      pageInstances[0] = page 2 = RIGHT первого разворота)
 *
 * Конвенция типографии: левые страницы НЕЧЁТНЫЕ (1, 3, 5...), правые ЧЁТНЫЕ
 * (2, 4, 6...).
 */
function softOffset(ctx: SectionFillContext): 0 | 1 {
  return ctx.bundle.preset.sheet_type === 'soft' ? 1 : 0;
}

/**
 * Возвращает 'left' или 'right' для записи pageInstances[index] с учётом
 * физических страниц. Не требует чтобы запись уже существовала — годится
 * также для index = pageInstances.length (определить позицию следующей
 * добавляемой страницы).
 */
function positionOfIndex(
  ctx: SectionFillContext,
  index: number,
): 'left' | 'right' {
  const physicalPage = index + 1 + softOffset(ctx);
  return physicalPage % 2 === 1 ? 'left' : 'right';
}

/**
 * Возвращает true если последняя положенная страница занимает LEFT и
 * соседняя RIGHT висит пустой — значит нужна закрывающая страница на R.
 *
 * Для пустого pageInstances возвращает false (закрывать нечего).
 */
function hasVacantRight(ctx: SectionFillContext): boolean {
  if (ctx.pageInstances.length === 0) return false;
  const lastIndex = ctx.pageInstances.length - 1;
  return positionOfIndex(ctx, lastIndex) === 'left';
}

// ─── Поиск combo-мастера (РЭ.37.2.b) ────────────────────────────────────

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
  // ─── РЭ.37.6: ручной сценарий из пресета ─────────────────────────────
  // Если в пресете явно задан custom-сценарий (через UI редактора пресетов
  // РЭ.37.6.d), используем его — это override OkeyBook-логики. Применяется
  // независимо от section_structure entry. Симметризация хвоста в этом
  // режиме игнорируется (партнёр сам решил что класть на хвост).
  const presetScenario = ctx.bundle.preset.transition_scenario;
  if (presetScenario && presetScenario.mode === 'custom') {
    fillPresetCustomScenario(ctx, presetScenario);
    return;
  }

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
  // или последний мастер неопознан — combo replacement не делаем (нечего
  // заменять или непонятно на что). Но если разворот висит без правой —
  // закрываем его через J-цепочку, даже без знания комплектации.
  //
  // РЭ.37.3.b.1 (25.05.2026): typical случай где это срабатывает —
  // students.ts (semantic-grid режим) кладёт legacy combined-tail мастер
  // (L-Combined-Page / M-Combined-Page / N-Combined-Page) через
  // findStudentGridMaster, потому что эти мастера матчатся по семантике
  // (students=remainder, photos_full=1). Их имена не распознаются
  // detectComplectationFromLastPage (которая знает только J-Combined-Tail-N
  // и N-Grid-N). До этого фикса transition пропускался и правая висела
  // пустой. Теперь хотя бы закроем разворот.
  if (!complectation) {
    // РЭ.37.4 (фикс 25.05.2026): если detectComplectationFromLastPage не
    // распознала мастер (legacy L-Combined-Page / M-Combined-Page и т.д.) —
    // ПОПРОБУЕМ всё-таки симметризацию через preset параметры. Партнёр в
    // редакторе шаблона явно указал student_grid_size — это надёжный
    // источник информации о комплектации, даже если последний мастер
    // legacy и его имя engine не знает.
    //
    // Маппинг preset → комплектация:
    //   1) student_layout_mode='grid' + student_grid_size=12 → mini
    //      student_layout_mode='grid' + student_grid_size=6  → light
    //   2) Fallback для legacy-пресетов (где новые поля не заданы):
    //      density='mini'  → mini
    //      density='light' → light
    //
    // Для других значений симметризация не применяется (по spec §3.4).
    const presetMode = ctx.bundle.preset.student_layout_mode;
    const presetGrid = ctx.bundle.preset.student_grid_size;
    const presetDensity = ctx.bundle.preset.density;
    let presetComplectation: Complectation | null = null;
    if (presetMode === 'grid') {
      if (presetGrid === 12) presetComplectation = 'mini';
      else if (presetGrid === 6) presetComplectation = 'light';
    }
    // Fallback на density если новые поля не заданы.
    if (presetComplectation === null) {
      if (presetDensity === 'mini') presetComplectation = 'mini';
      else if (presetDensity === 'light') presetComplectation = 'light';
    }

    if (presetComplectation !== null) {
      const studentsCount = ctx.input.students.length;
      const layoutFromPreset = classifyTransitionLayout(
        presetComplectation,
        studentsCount,
      );
      const symmetrized = trySymmetrizeTail(
        ctx,
        presetComplectation,
        layoutFromPreset,
      );
      if (symmetrized) {
        ctx.decisionTrace.push({
          spread_index: Math.floor(ctx.pageInstances.length / 2),
          section_index: ctx.sectionIndex,
          family_id: 'transition',
          rule_id: 'okeybook_default:symmetrize_from_preset',
          inputs: {
            preset_grid_size: presetGrid,
            preset_density: presetDensity,
            inferred_complectation: presetComplectation,
            students_count: studentsCount,
          },
        });
        // Симметризация сработала: combo уже на хвосте. Если правая
        // висит — закрываем через J-цепочку как обычно.
        if (hasVacantRight(ctx)) {
          tryJChainClosing(ctx);
        }
        return;
      }
      // Симметризация не сработала (например tail≠1) — продолжим со
      // старым поведением для legacy-комплектации.
    }

    if (hasVacantRight(ctx)) {
      ctx.warnings.push(
        'transition_complectation_unknown: переходный разворот закрыт ' +
          'запасным шаблоном (combo-замена пропущена, потому что комплектацию ' +
          'учеников не удалось определить по последней странице раздела). ' +
          'Это нормально для legacy-шаблонов; если хотите явный combo — ' +
          'обновите шаблон в /super.',
      );
    }
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2),
      section_index: ctx.sectionIndex,
      family_id: 'transition',
      rule_id: 'skip:complectation_unknown_combo',
      inputs: { last_master_id: lastPage?.master_id ?? null },
    });
    // Закрываем правую если висит — combo не сделали, но closing нужен.
    if (hasVacantRight(ctx)) {
      tryJChainClosing(ctx);
    }
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

  // РЭ.37.4: симметризация хвоста (опт-ин через preset.symmetrize_students_tail).
  // Применяется только для Mini/Light с tail=1: забирает 1 ученика с
  // предыдущей полной страницы, на хвостовой combo с 2 учениками вместо 1.
  // Если симметризация сработала — combo уже положен, обычный шаг А
  // пропускается. Closing через J-цепочку запускается как обычно.
  const symmetrized = trySymmetrizeTail(ctx, complectation, layout);

  // 2. Шаг А: если tail_page='combo' — заменить хвостовую страницу
  //    students на combo-мастер. POP + PUSH. Пропускается если уже
  //    применена симметризация — она положила combo сама.
  if (
    !symmetrized &&
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

  // 3. Шаг B: если последняя страница висит на LEFT — нужна закрывающая
  //    страница через J-цепочку на правой. РЭ.37.3.b: учитываем sheet_type
  //    через hasVacantRight (для soft binding формула чётности инвертирована).
  if (hasVacantRight(ctx)) {
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
  // РЭ.37.3.b: считаем по физической странице с учётом sheet_type.
  const position: 'left' | 'right' = positionOfIndex(ctx, tailIndex);

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
  // РЭ.37.3.b: физическая позиция следующей страницы с учётом sheet_type.
  // tryJChainClosing вызывается из fillOkeybookDefault только если
  // hasVacantRight(ctx) — то есть position здесь всегда 'right'. Считаем
  // явно для symmetry с tryReplaceTailWithCombo и на случай если функция
  // будет переиспользована из других callsite в будущем.
  const position: 'left' | 'right' = positionOfIndex(ctx, pageIndex);

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

  // РЭ.37.3.b.2: формулировка для партнёра. Указываем что именно не нашлось
  // и какое действие предпринять. Перечисляем доступность всех 3 категорий
  // J-цепочки чтобы партнёр сразу видел сколько каких фото есть.
  const av = ctx.available;
  ctx.warnings.push(
    `transition_skipped: правая страница переходного разворота не закрыта — ` +
      `не нашлось ни одной комбинации мастер+фото. Доступно: ` +
      `${av.sixth} фото для коллажа, ${av.half_class} половинных, ` +
      `${av.full_class} общих. Загрузите ещё фото в любую из этих категорий, ` +
      `либо замените шаблон вручную в редакторе.`,
  );
  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: 'skip:no_j_master_or_photos',
    inputs: { available: { ...ctx.available } },
  });
}

// ─── РЭ.37.4: симметризация хвоста (опт-ин) ─────────────────────────────

/**
 * РЭ.37.4: симметризация хвоста students-секции.
 *
 * Условия применения (все должны быть выполнены):
 *   1. preset.symmetrize_students_tail === true (опт-ин, по умолчанию false)
 *   2. complectation ∈ {'mini', 'light'} — для медиум/стандарт/унив/максимум
 *      симметризация не применяется (см. spec §3.4)
 *   3. layout.tail === 1 — на хвостовой странице один одинокий ученик
 *   4. layout.combo_master_base !== null — есть на что класть combo
 *   5. pageInstances содержит минимум 2 страницы students (хвостовая +
 *      предыдущая полная сетка)
 *
 * Что делает:
 *   • POP хвостовой страницы (combined-tail с 1 учеником + classphoto)
 *   • POP предыдущей полной страницы (grid с N учениками)
 *   • Восстанавливает ctx.available.full_class (хвостовая потребила 1)
 *   • PUSH предыдущей страницы заново — с (N-1) учениками, последний слот
 *     останется __hidden__
 *   • PUSH хвостовой combo-страницы с 2 учениками + classphoto, лишние
 *     слоты __hidden__
 *
 * После симметризации обычная combo-replacement-логика НЕ запускается
 * (combo уже положен). Closing через J-цепочку — запускается отдельно
 * вызывающим кодом (fillOkeybookDefault).
 *
 * Returns:
 *   true если симметризация успешно применена.
 *   false если условия не выполнены или что-то пошло не так (combo не
 *   найден, grid-мастер не найден — в таком случае POP'ы откатываются).
 *
 * АРХИТЕКТУРНОЕ ЗАМЕЧАНИЕ — placeholder_centering:
 *   Spec §3.4 описывает что после перераспределения учеников оба
 *   «дефицита» (предыдущая страница с 5/6 и хвостовая с 2/3) должны
 *   центрироваться (placeholder_centering). Сейчас это НЕ реализовано —
 *   только перераспределение + __hidden__. Реальное центрирование
 *   через __pos__ ключи требует знать геометрию мастера и пересчитать
 *   позиции — отдельная задача (см. spec §7 «Открытые риски»). Можно
 *   решить через РЭ.37.8 (Сергей нарисует мастера сразу с правильным
 *   расположением слотов для типичных tail-cases) или отдельной фазой
 *   автоцентрирования.
 */
function trySymmetrizeTail(
  ctx: SectionFillContext,
  complectation: Complectation,
  layout: TransitionLayout,
): boolean {
  // 1. Проверка флага.
  if (ctx.bundle.preset.symmetrize_students_tail !== true) return false;

  // 2. Только Mini / Light.
  if (complectation !== 'mini' && complectation !== 'light') return false;

  // 3. Только tail=1 и combo-master известен.
  if (layout.tail !== 1) return false;
  if (layout.combo_master_base === null) return false;
  if (layout.combo_capacity === null) return false;

  // 4. Нужно минимум 2 страницы students (хвостовая + предпоследняя полная).
  if (ctx.pageInstances.length < 2) return false;

  // 5. POP хвостовой страницы + восстановление classphoto если был.
  const tailPage = ctx.pageInstances.pop();
  if (!tailPage) return false;
  const hadClassphoto =
    typeof tailPage.bindings?.classphotoframe === 'string' &&
    tailPage.bindings.classphotoframe.length > 0;
  if (hadClassphoto) ctx.available.full_class += 1;

  // 6. POP предыдущей полной страницы.
  const previousPage = ctx.pageInstances.pop();
  if (!previousPage) {
    // Защита: откат + return.
    ctx.pageInstances.push(tailPage);
    if (hadClassphoto) ctx.available.full_class -= 1;
    return false;
  }

  // 7. Найти grid-мастер из id предыдущей страницы.
  let gridMaster: SpreadTemplate | undefined;
  for (const m of Array.from(ctx.bundle.mastersByName.values())) {
    if (m.id === previousPage.master_id) {
      gridMaster = m;
      break;
    }
  }
  if (!gridMaster) {
    // Откат: страницы не нашлись — симметризация невозможна.
    ctx.pageInstances.push(previousPage);
    ctx.pageInstances.push(tailPage);
    if (hadClassphoto) ctx.available.full_class -= 1;
    return false;
  }

  // 8. Узнать число slot'ов в grid-мастере (количество studentportrait_*).
  let gridSize = 0;
  for (const ph of gridMaster.placeholders ?? []) {
    if (/^studentportrait_\d+$/i.test(ph.label)) gridSize++;
  }
  if (gridSize < 2) {
    // Не похоже на grid — откат.
    ctx.pageInstances.push(previousPage);
    ctx.pageInstances.push(tailPage);
    if (hadClassphoto) ctx.available.full_class -= 1;
    return false;
  }

  // 9. Найти combo-мастер для текущей комплектации с учётом позиции.
  // После двух POP'ов combo ляжет на ctx.pageInstances.length + 1
  // (previousPage сначала запушится, затем combo).
  const newComboIndex = ctx.pageInstances.length + 1;
  const positionForCombo = positionOfIndex(ctx, newComboIndex);
  const combo = findComboMaster(
    ctx.bundle.mastersByName,
    layout.combo_master_base,
    positionForCombo,
  );
  if (!combo) {
    // Combo не найден — откат.
    ctx.pageInstances.push(previousPage);
    ctx.pageInstances.push(tailPage);
    if (hadClassphoto) ctx.available.full_class -= 1;
    return false;
  }

  // 10. Вычислить новые наборы учеников.
  // students input layout до симметризации:
  //   previous (полная сетка): students[N-1-gridSize .. N-2]   (gridSize шт)
  //   tail (1 ученик):         students[N-1]                   (1 шт)
  // После:
  //   previous: students[N-1-gridSize .. N-3]                  (gridSize-1 шт)
  //   combo:    students[N-2 .. N-1]                           (2 шт)
  const N = ctx.input.students.length;
  if (N < gridSize + 1) {
    // Учеников мало — откат (защита от edge case).
    ctx.pageInstances.push(previousPage);
    ctx.pageInstances.push(tailPage);
    if (hadClassphoto) ctx.available.full_class -= 1;
    return false;
  }
  const prevStudents = ctx.input.students.slice(N - 1 - gridSize, N - 2);
  const tailStudents = ctx.input.students.slice(N - 2, N);

  // 11. PUSH предыдущей страницы с gridSize-1 учениками. Последний слот
  // останется __hidden__ через стандартный bindGridStudents.
  pushGridPage(
    ctx,
    gridMaster,
    prevStudents,
    gridSize,
    `transition:symmetrized:prev:${gridMaster.name}`,
  );

  // 12. PUSH combo-страницы с 2 учениками + classphoto. comboSlots —
  // ёмкость combo по spec (combo-3 для light, combo-4 для mini).
  pushCombinedTailPage(
    ctx,
    combo,
    tailStudents,
    layout.combo_capacity,
    complectation,
  );

  // 13. Decision trace + info-warning.
  ctx.decisionTrace.push({
    spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: `symmetrize:${complectation}:${combo.name}`,
    inputs: {
      complectation,
      combo_master: combo.name,
      grid_master: gridMaster.name,
      grid_size: gridSize,
      students_total: N,
      prev_students_count: prevStudents.length,
      tail_students_count: tailStudents.length,
      combo_position: positionForCombo,
    },
  });

  ctx.warnings.push(
    `transition_symmetrized: хвост распределён симметрично — на предыдущей ` +
      `странице ${prevStudents.length} учеников вместо ${gridSize}, на ` +
      `хвостовой ${tailStudents.length} вместо 1. Включено флагом ` +
      `«симметризировать хвост» в шаблоне.`,
  );

  return true;
}

// ─── РЭ.37.6: ручной сценарий из preset.transition_scenario ─────────────

/**
 * РЭ.37.6: заполнение transition по ручному сценарию из пресета.
 *
 * В отличие от fillCustomMode (РЭ.37.2.c, который читает custom из
 * section_structure entry и применяется ТОЛЬКО для combo-кейсов),
 * эта функция:
 *   • Читает сценарий из preset.transition_scenario (TransitionScenario,
 *     mode='custom').
 *   • Применяется ВСЕГДА когда сценарий есть — независимо от чётности,
 *     наличия combo, типа последней students-страницы и т.д.
 *   • НЕ определяет комплектацию (detectComplectation не вызывается).
 *   • НЕ применяет симметризацию (партнёр явно решил что класть).
 *
 * Алгоритм:
 *   1. Если tail_left_master_id задан:
 *      • POP последней students-страницы (она будет заменена).
 *        Восстанавливаем available.full_class если popped был
 *        combined_tail с classphoto.
 *      • Найти мастер в template_set по id. Если не найден → warning,
 *        возвращаем popped обратно.
 *      • PUSH мастер:
 *        – Если содержит studentportrait_N — это grid/combo, используем
 *          pushCombinedTailPage или pushGridPage с теми же tail-учениками.
 *        – Иначе — это common-мастер, используем bindCommonPhotos.
 *   2. Если tail_right_master_id задан И правая висит — PUSH мастер.
 *   3. Если tail_right_master_id НЕ задан И правая висит — стандартный
 *      tryJChainClosing.
 *
 * closing_master_id пока ИГНОРИРУЕТСЯ — резерв на будущее.
 */
function fillPresetCustomScenario(
  ctx: SectionFillContext,
  scenario: Extract<TransitionScenario, { mode: 'custom' }>,
): void {
  ctx.decisionTrace.push({
    spread_index: Math.floor(ctx.pageInstances.length / 2),
    section_index: ctx.sectionIndex,
    family_id: 'transition',
    rule_id: 'preset_custom_scenario:start',
    inputs: {
      tail_left_master_id: scenario.tail_left_master_id,
      tail_right_master_id: scenario.tail_right_master_id,
    },
  });

  // Шаг 1: замена левой (хвостовой) страницы.
  if (scenario.tail_left_master_id !== null) {
    const masterId = scenario.tail_left_master_id;
    let leftMaster: SpreadTemplate | undefined;
    for (const m of Array.from(ctx.bundle.mastersByName.values())) {
      if (m.id === masterId) {
        leftMaster = m;
        break;
      }
    }
    if (!leftMaster) {
      ctx.warnings.push(
        `transition_custom_master_not_found: мастер с id='${masterId}' ` +
          `(tail_left из preset.transition_scenario) не найден в ` +
          `template_set. Хвостовая students-страница оставлена как есть.`,
      );
    } else if (ctx.pageInstances.length === 0) {
      ctx.warnings.push(
        'transition_custom_no_tail_page: preset.transition_scenario задаёт ' +
          'tail_left, но pageInstances пуст (students-секция не положила ни ' +
          'одной страницы). tail_left не применён.',
      );
    } else {
      const popped = ctx.pageInstances.pop()!;
      const poppedHadClassphoto =
        typeof popped.bindings?.classphotoframe === 'string' &&
        popped.bindings.classphotoframe.length > 0;
      if (poppedHadClassphoto) {
        ctx.available.full_class += 1;
      }

      const hasStudentPortraits = (leftMaster.placeholders ?? []).some(
        (ph) => /^studentportrait_\d+$/i.test(ph.label),
      );
      const hasClassPhoto = (leftMaster.placeholders ?? []).some(
        (ph) => ph.label.toLowerCase() === 'classphotoframe',
      );

      if (hasStudentPortraits) {
        // Grid / Combo мастер. Берём хвостовых учеников из popped.
        let capacity = 0;
        for (const ph of leftMaster.placeholders ?? []) {
          if (/^studentportrait_\d+$/i.test(ph.label)) capacity++;
        }
        let tailCount = 0;
        for (const key of Object.keys(popped.bindings ?? {})) {
          if (
            /^studentportrait_\d+$/i.test(key) &&
            typeof popped.bindings[key] === 'string'
          ) {
            tailCount++;
          }
        }
        if (tailCount === 0) tailCount = 1;
        const tailStudents = ctx.input.students.slice(
          ctx.input.students.length - tailCount,
        );
        if (hasClassPhoto) {
          pushCombinedTailPage(ctx, leftMaster, tailStudents, capacity, 'mini');
        } else {
          pushGridPage(
            ctx,
            leftMaster,
            tailStudents,
            capacity,
            `preset_custom_scenario:tail_left:${leftMaster.name}`,
          );
        }
      } else {
        // Common-мастер.
        let halfCount = 0;
        let quarterCount = 0;
        let collageCount = 0;
        let hasFull = false;
        let hasSpread = false;
        for (const ph of leftMaster.placeholders ?? []) {
          const label = ph.label.toLowerCase();
          if (label === 'classphotoframe') hasFull = true;
          else if (/^halfphoto_\d+$/.test(label)) halfCount++;
          else if (/^quarterphoto_\d+$/.test(label)) quarterCount++;
          else if (/^collagephoto_\d+$/.test(label)) collageCount++;
          else if (label === 'spreadphoto') hasSpread = true;
        }
        if (hasSpread) {
          ctx.warnings.push(
            `transition_custom_spread_unsupported: мастер '${leftMaster.name}' ` +
              `(tail_left из preset.transition_scenario) — это J-Spread. ` +
              `Spread-мастера в transition пока не поддерживаются. Хвост ` +
              `students оставлен как был.`,
          );
          ctx.pageInstances.push(popped);
          if (poppedHadClassphoto) ctx.available.full_class -= 1;
        } else {
          const bindings = bindCommonPhotos(leftMaster, ctx.input, ctx.available);
          const consumes: SlotConsumes = {};
          if (collageCount > 0) consumes.sixth = collageCount;
          else if (quarterCount >= 4) consumes.quarter = 4;
          else if (halfCount >= 2) consumes.half_class = 2;
          else if (hasFull) consumes.full_class = 1;
          if (Object.keys(consumes).length > 0) {
            decrementAvailable(ctx.available, consumes);
          }
          ctx.pageInstances.push({ master_id: leftMaster.id, bindings });
        }
      }

      ctx.decisionTrace.push({
        spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
        section_index: ctx.sectionIndex,
        family_id: 'transition',
        rule_id: `preset_custom_scenario:tail_left:${leftMaster.name}`,
        inputs: {
          master_id: masterId,
          master_name: leftMaster.name,
          had_student_portraits: hasStudentPortraits,
          had_class_photo: hasClassPhoto,
        },
      });
    }
  }

  // Шаг 2: правая страница.
  if (scenario.tail_right_master_id !== null) {
    const masterId = scenario.tail_right_master_id;
    let rightMaster: SpreadTemplate | undefined;
    for (const m of Array.from(ctx.bundle.mastersByName.values())) {
      if (m.id === masterId) {
        rightMaster = m;
        break;
      }
    }
    if (!rightMaster) {
      ctx.warnings.push(
        `transition_custom_master_not_found: мастер с id='${masterId}' ` +
          `(tail_right из preset.transition_scenario) не найден в ` +
          `template_set. Закрытие через стандартную J-цепочку.`,
      );
      if (hasVacantRight(ctx)) {
        tryJChainClosing(ctx);
      }
    } else if (!hasVacantRight(ctx)) {
      ctx.warnings.push(
        `transition_custom_right_skipped: tail_right_master_id задан, но ` +
          `правая страница уже занята. Мастер '${rightMaster.name}' пропущен.`,
      );
    } else {
      let halfCount = 0;
      let quarterCount = 0;
      let collageCount = 0;
      let hasFull = false;
      for (const ph of rightMaster.placeholders ?? []) {
        const label = ph.label.toLowerCase();
        if (label === 'classphotoframe') hasFull = true;
        else if (/^halfphoto_\d+$/.test(label)) halfCount++;
        else if (/^quarterphoto_\d+$/.test(label)) quarterCount++;
        else if (/^collagephoto_\d+$/.test(label)) collageCount++;
      }
      const bindings = bindCommonPhotos(rightMaster, ctx.input, ctx.available);
      const consumes: SlotConsumes = {};
      if (collageCount > 0) consumes.sixth = collageCount;
      else if (quarterCount >= 4) consumes.quarter = 4;
      else if (halfCount >= 2) consumes.half_class = 2;
      else if (hasFull) consumes.full_class = 1;
      if (Object.keys(consumes).length > 0) {
        decrementAvailable(ctx.available, consumes);
      }
      ctx.pageInstances.push({ master_id: rightMaster.id, bindings });
      ctx.decisionTrace.push({
        spread_index: Math.floor((ctx.pageInstances.length - 1) / 2),
        section_index: ctx.sectionIndex,
        family_id: 'transition',
        rule_id: `preset_custom_scenario:tail_right:${rightMaster.name}`,
        inputs: {
          master_id: masterId,
          master_name: rightMaster.name,
        },
      });
    }
  } else if (hasVacantRight(ctx)) {
    tryJChainClosing(ctx);
  }
}

// ─── Ветка 2: legacy РЭ.32 (master_name явно задан) ─────────────────────

function fillLegacyMasterName(ctx: SectionFillContext, masterName: string): void {
  // РЭ.37.3.b: учитываем sheet_type. Legacy РЭ.32 кладёт мастер только
  // если висит правая (left занят, right пустой). Для hard это длина
  // нечётная, для soft — чётная (см. positionOfIndex / hasVacantRight).
  if (!hasVacantRight(ctx)) {
    ctx.decisionTrace.push({
      spread_index: Math.floor(ctx.pageInstances.length / 2),
      section_index: ctx.sectionIndex,
      family_id: 'transition',
      rule_id: 'skip:even_pages',
      inputs: {
        pages_so_far: ctx.pageInstances.length,
        sheet_type: ctx.bundle.preset.sheet_type ?? null,
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
