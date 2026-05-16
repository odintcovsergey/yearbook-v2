/**
 * Rule Engine — главный orchestrator buildFromRules.
 *
 * Спецификация: docs/rule-engine-spec.md v1.3 §9 (псевдокод алгоритма).
 *
 * Входы:
 *   - input  — данные альбома (RulesAlbumInput)
 *   - bundle — preset + rules + masters + families (см. loaders.ts)
 *
 * Выход: AlbumLayout (см. types.ts §9).
 *
 * Ключевая стратегия безопасности:
 *   - Функция НИКОГДА не бросает исключения. Любая ошибка (отсутствующий
 *     мастер, неизвестное правило, сломанное выражение) пишется в `warnings`,
 *     а в `status` ставится 'partial' или 'failed'. Это позволяет caller'у
 *     (POST /api/layout) сделать осознанный фолбэк на legacy buildAlbum.
 *   - Защита от бесконечного цикла: если правило не потребляет данных,
 *     секция завершается.
 *   - Защита от бесконечного цикла #2: жёсткий лимит 200 итераций на секцию.
 *
 * Стиль:
 *   - validateSectionParams (из schemas.ts) вызывается перед каждой секцией.
 *   - decision_trace заполняется для каждого применённого правила.
 *   - Балансировка применяется к каждой произведённой странице.
 */

import type {
  AlbumLayout,
  DecisionTraceEntry,
  Density,
  PageInstance,
  Preset,
  Rule,
  RuleContext,
  RulesAlbumInput,
  Section,
  SpreadInstance as RulesSpreadInstance,
  WhenClause,
} from './types';
import { applyRule, type ProducedPage } from './apply';
import { applyBalance } from './balance';
import { evaluateWhen, resolveNumber, type EvalScope } from './evaluate';
import { validateSectionParams, SectionSchema } from './schemas';
import type { RuleEngineBundle } from './loaders';

const HARD_LOOP_LIMIT = 200;

/**
 * Семейства, для которых правила могут срабатывать многократно в одной
 * секции (итеративные): student-section потребляет по N учеников за раз,
 * common-section потребляет фото пачками до исчерпания.
 *
 * Все остальные семейства (head-teacher, intro, final, subject-teachers,
 * class-photo) — singleton: одно срабатывание на альбом. Без этой логики
 * правило типа t-class-1-4-half потребляло бы по 2 фото half_class и
 * срабатывало повторно пока фото полкласса не кончатся → получался бы
 * альбом из 19 учительских разворотов вместо одного. Защита через
 * cursorsChanged не помогает в этом случае, потому что правило ЧТО-ТО
 * потребляет (фото), просто не относящееся к head-teacher.
 *
 * Решение через хардкод проще миграции БД с полем templateFamily.iterative,
 * и список этих семейств меняется редко.
 */
const ITERATIVE_FAMILIES: ReadonlySet<string> = new Set([
  'student-section',
  'common-section',
]);

// =============================================================================
// 1. Public API
// =============================================================================

/**
 * Главный build entry point. Чистая функция, не делает запросов в БД.
 * Возвращает AlbumLayout с детальным decision_trace и warnings.
 *
 * Не бросает. Любая критическая ошибка → status='failed'.
 */
export function buildFromRules(
  input: RulesAlbumInput,
  bundle: RuleEngineBundle,
): AlbumLayout {
  const warnings: string[] = [];
  const decisionTrace: DecisionTraceEntry[] = [];
  const spreads: RulesSpreadInstance[] = [];

  const preset = bundle.preset;

  // Курсоры и состояние
  const cursors: Record<string, number> = {
    current_student_index: 0,
    consumed_full_class: 0,
    consumed_half_class: 0,
    consumed_spread: 0,
    consumed_quarter: 0,
    consumed_sixth: 0,
  };
  let pendingRightPageSpreadIndex: number | null = null;
  let nextSpreadIndex = 0;

  try {
    for (let sectionIndex = 0; sectionIndex < preset.sections.length; sectionIndex++) {
      const section = preset.sections[sectionIndex];

      // enabled_when
      if (section.enabled_when) {
        const ctxProbe = buildContext(
          input,
          section,
          sectionIndex,
          preset,
          cursors,
          pendingRightPageSpreadIndex !== null,
        );
        if (!evaluateWhen(section.enabled_when, ctxProbe)) {
          continue;
        }
      }

      // Валидация параметров по §4.4 (матрица density × params).
      // SectionSchema parse гарантирует совместимость типов с validateSectionParams.
      const parsedSection = SectionSchema.safeParse(section);
      if (parsedSection.success) {
        const paramErrors = validateSectionParams(parsedSection.data);
        for (const e of paramErrors) {
          warnings.push(`section[${sectionIndex}] ${section.family_id}: ${e}`);
        }
      }

      // Сбрасываем current_student_index при входе в новую student-section
      // (несколько секций student-section в одном пресете — Индивидуальный).
      if (section.family_id === 'student-section') {
        cursors.current_student_index = 0;
      }

      // Фильтр правил для семейства (упорядочены по priority desc уже в loaders.ts).
      const sectionRules = bundle.rules.filter((r) => r.family_id === section.family_id);

      // Цикл по правилам секции
      let safety = 0;
      while (safety < HARD_LOOP_LIMIT) {
        safety++;
        const ctx = buildContext(
          input,
          section,
          sectionIndex,
          preset,
          cursors,
          pendingRightPageSpreadIndex !== null,
        );

        const applicable = sectionRules.find((r) => evaluateWhen(r.when, ctx));
        if (!applicable) break;

        // variants — pickVariant в MVP: первый с when_default или первый.
        const ruleToApply = pickVariant(applicable, ctx);

        // Снапшот курсоров до применения (для детекции бесконечного цикла)
        const cursorsBefore = { ...cursors };

        // Применить правило
        const produced = applyRule(
          ruleToApply,
          ctx,
          input,
          cursors,
          bundle.mastersByName,
        );

        for (const e of produced.resolve_errors) {
          warnings.push(`rule '${ruleToApply.id}': ${e}`);
        }

        // Применить балансировку к каждой странице (если в правиле balance)
        let balancedAny = false;
        if (produced.left) {
          const m = bundle.mastersByName.get(produced.left.master_name);
          const r = applyBalance(produced.left, m, ruleToApply.balance);
          if (r.applied) balancedAny = true;
        }
        if (produced.right) {
          const m = bundle.mastersByName.get(produced.right.master_name);
          const r = applyBalance(produced.right, m, ruleToApply.balance);
          if (r.applied) balancedAny = true;
        }

        // Поместить страницы в spreads с учётом pending_right_page
        const placement = placePages(
          produced,
          spreads,
          pendingRightPageSpreadIndex,
          nextSpreadIndex,
        );
        pendingRightPageSpreadIndex = placement.pending;
        nextSpreadIndex = placement.nextIndex;

        // Decision trace
        decisionTrace.push({
          spread_index: placement.spreadIndex,
          section_index: sectionIndex,
          family_id: section.family_id,
          rule_id: ruleToApply.id,
          variant_id: ruleToApply.id !== applicable.id ? ruleToApply.id : undefined,
          mixed_pages: placement.mixedPages
            ? { left_rule_id: placement.previousLeftRuleId ?? '', right_rule_id: ruleToApply.id }
            : undefined,
          inputs: {
            students_remaining: ctx.students_remaining,
            current_student_index: ctx.current_student_index,
            subjects_count: ctx.subjects_count,
          },
          balanced: balancedAny || undefined,
        });

        // Сдвинуть курсоры по consumes
        advanceCursors(cursors, ruleToApply, ctx, input);

        // Защита от бесконечного цикла. Warning логичен только для
        // итеративных семейств — там это сигнал что правило срабатывает
        // но не двигает курсоры (потенциальный баг правила).
        // Для singleton (head-teacher/intro/final) правило без consumes —
        // нормальное явление (final-text-only, t-class-*-no-common). Не
        // спамим warnings в UI.
        if (!cursorsChanged(cursorsBefore, cursors)) {
          if (ITERATIVE_FAMILIES.has(section.family_id)) {
            warnings.push(
              `section[${sectionIndex}] ${section.family_id}: rule '${ruleToApply.id}' consumed nothing — stopping section`,
            );
          }
          break;
        }

        // Singleton-семейства: одно срабатывание на секцию.
        // head-teacher / intro / final / subject-teachers / class-photo —
        // концептуально однократные части альбома. Без этого выхода правило
        // вроде t-class-1-4-half срабатывало бы повторно пока есть фото
        // полкласса (cursorsChanged=true каждый раз, защита выше не сработает).
        if (!ITERATIVE_FAMILIES.has(section.family_id)) {
          break;
        }
      }
      if (safety >= HARD_LOOP_LIMIT) {
        warnings.push(
          `section[${sectionIndex}] ${section.family_id}: hard loop limit (${HARD_LOOP_LIMIT}) hit`,
        );
      }
    }
  } catch (e) {
    warnings.push(`fatal: ${(e as Error).message}`);
    return {
      spreads,
      decision_trace: decisionTrace,
      rules_version: computeRulesVersion(preset, bundle.rules),
      preset_id: preset.id,
      status: 'failed',
      warnings,
    };
  }

  const status: AlbumLayout['status'] =
    warnings.length === 0 ? 'ok' : warnings.some((w) => w.startsWith('fatal:')) ? 'failed' : 'partial';

  return {
    spreads,
    decision_trace: decisionTrace,
    rules_version: computeRulesVersion(preset, bundle.rules),
    preset_id: preset.id,
    status,
    warnings,
  };
}

// =============================================================================
// 2. buildContext — снапшот контекста для evaluateWhen и apply
// =============================================================================

function buildContext(
  input: RulesAlbumInput,
  section: Section,
  _sectionIndex: number,
  preset: Preset,
  cursors: Record<string, number>,
  hasPendingRightPage: boolean,
): RuleContext {
  const studentsCount = input.students.length;
  const consumedStudents = cursors.current_student_index;
  const studentsRemaining = Math.max(0, studentsCount - consumedStudents);

  const currentStudent = input.students[consumedStudents];
  const friendPhotosCount = currentStudent?.friend_photos?.length ?? 0;

  const fullClassRemaining = Math.max(
    0,
    input.common_photos.full_class.length - cursors.consumed_full_class,
  );
  const halfClassRemaining = Math.max(
    0,
    input.common_photos.half_class.length - cursors.consumed_half_class,
  );
  const spreadRemaining = Math.max(
    0,
    input.common_photos.spread.length - cursors.consumed_spread,
  );
  const quarterRemaining = Math.max(
    0,
    input.common_photos.quarter.length - cursors.consumed_quarter,
  );
  const sixthRemaining = Math.max(
    0,
    input.common_photos.sixth.length - cursors.consumed_sixth,
  );

  return {
    subjects_count: input.subjects.length,
    students_count: studentsCount,
    students_remaining: studentsRemaining,
    current_student_index: consumedStudents,
    head_teacher: {
      has_photo: !!input.head_teacher.photo,
      has_text: !!input.head_teacher.text && input.head_teacher.text.trim().length > 0,
    },
    common_photos: {
      full_class: { count: fullClassRemaining, has_any: fullClassRemaining > 0 },
      half_class: { count: halfClassRemaining, has_any: halfClassRemaining > 0 },
      spread: { count: spreadRemaining, has_any: spreadRemaining > 0 },
      quarter: { count: quarterRemaining, has_any: quarterRemaining > 0 },
      sixth: { count: sixthRemaining, has_any: sixthRemaining > 0 },
    },
    print_type: preset.print_type,
    section: {
      position: 'middle',
      density: section.params?.density as Density | undefined,
      has_quote: section.params?.has_quote,
      has_friend_photos: section.params?.has_friend_photos,
      friend_photos_max: section.params?.friend_photos_max,
    },
    prev_spread: {
      right_page_empty: hasPendingRightPage,
    },
    friend_photos_count: friendPhotosCount,
  };
}

// =============================================================================
// 3. pickVariant — выбор варианта правила (MVP: первый или по when_default)
// =============================================================================

function pickVariant(rule: Rule, ctx: RuleContext): Rule {
  if (!rule.variants || rule.variants.length === 0) return rule;
  // 1) Если у какого-то варианта есть when_default и он матчит — берём.
  //    when_default — расширение схемы для variants из spec §7.6,
  //    не описано в основной RuleSchema, читаем через индексный доступ.
  for (const v of rule.variants) {
    const extra = v as Rule & { when_default?: WhenClause };
    const wd = extra.when_default;
    if (wd && evaluateWhen(wd, ctx)) {
      return mergeVariant(rule, v);
    }
  }
  // 2) Иначе — первый вариант (default-by-position).
  return mergeVariant(rule, rule.variants[0]);
}

function mergeVariant(parent: Rule, variant: Rule): Rule {
  return {
    ...parent,
    ...variant,
    // family_id и priority наследуем у parent, всё остальное — у variant
    family_id: parent.family_id,
    priority: parent.priority,
  };
}

// =============================================================================
// 4. placePages — куда положить произведённые страницы
// =============================================================================

interface PlacementResult {
  spreadIndex: number;
  pending: number | null;
  nextIndex: number;
  mixedPages: boolean;
  previousLeftRuleId?: string;
}

function placePages(
  produced: ReturnType<typeof applyRule>,
  spreads: RulesSpreadInstance[],
  pendingRightPageSpreadIndex: number | null,
  nextSpreadIndex: number,
): PlacementResult {
  // Случай 1: type='spread' (left+right разные мастера) → новый разворот
  if (produced.left && produced.right) {
    // Если был pending right page — оставляем его пустым (висящим)
    const newSpread: RulesSpreadInstance = {
      spread_index: nextSpreadIndex,
      left: pageToInstance(produced.left),
      right: pageToInstance(produced.right),
      is_spread: produced.is_full_spread_master || undefined,
    };
    spreads.push(newSpread);
    return {
      spreadIndex: nextSpreadIndex,
      pending: null, // полный разворот — pending сбрасывается
      nextIndex: nextSpreadIndex + 1,
      mixedPages: false,
    };
  }

  // Случай 2: type='page' side='right' → попадает на pending spread (mixed)
  // или начинает новый разворот (правая без левой — необычно, но допустимо)
  if (produced.right && !produced.left) {
    if (pendingRightPageSpreadIndex !== null) {
      const spread = spreads[pendingRightPageSpreadIndex];
      spread.right = pageToInstance(produced.right);
      spread.mixed_pages = true;
      return {
        spreadIndex: pendingRightPageSpreadIndex,
        pending: null,
        nextIndex: nextSpreadIndex,
        mixedPages: true,
      };
    }
    // Нет pending — создаём новый разворот с пустой левой
    const newSpread: RulesSpreadInstance = {
      spread_index: nextSpreadIndex,
      right: pageToInstance(produced.right),
    };
    spreads.push(newSpread);
    return {
      spreadIndex: nextSpreadIndex,
      pending: null,
      nextIndex: nextSpreadIndex + 1,
      mixedPages: false,
    };
  }

  // Случай 3: type='page' side='left' или side='any' → новый разворот, правая висит
  if (produced.left && !produced.right) {
    const newSpread: RulesSpreadInstance = {
      spread_index: nextSpreadIndex,
      left: pageToInstance(produced.left),
    };
    spreads.push(newSpread);
    return {
      spreadIndex: nextSpreadIndex,
      // side='any' — НЕ ставим pending (any может означать что страница самодостаточна).
      // side='left' — ставим pending (ждём правую).
      pending: produced.left.side === 'left' ? nextSpreadIndex : null,
      nextIndex: nextSpreadIndex + 1,
      mixedPages: false,
    };
  }

  // Случай 4: ничего не произведено — без изменений
  return {
    spreadIndex: nextSpreadIndex,
    pending: pendingRightPageSpreadIndex,
    nextIndex: nextSpreadIndex,
    mixedPages: false,
  };
}

function pageToInstance(p: ProducedPage): PageInstance {
  return {
    master_id: p.master_id ?? `__missing__/${p.master_name}`,
    bindings: { ...p.bindings, __master_name__: p.master_name },
  };
}

// =============================================================================
// 5. advanceCursors — сдвиг курсоров после применения правила
// =============================================================================

function advanceCursors(
  cursors: Record<string, number>,
  rule: Rule,
  ctx: RuleContext,
  input: RulesAlbumInput,
): void {
  const consumes = rule.consumes;
  if (!consumes) return;

  if (consumes.students !== undefined) {
    const n = resolveConsumesNumber(consumes.students, ctx, input);
    if (Number.isFinite(n)) cursors.current_student_index += n;
  }
  if (consumes.common_photos) {
    const c = consumes.common_photos;
    if (c.full_class) cursors.consumed_full_class += c.full_class;
    if (c.half_class) cursors.consumed_half_class += c.half_class;
    if (c.spread) cursors.consumed_spread += c.spread;
    if (c.quarter) cursors.consumed_quarter += c.quarter;
    if (c.sixth) cursors.consumed_sixth += c.sixth;
  }
}

/**
 * Резолвит значение consumes.students — может быть число или строка-выражение.
 * Поддерживаем простые случаи: 'students_remaining', 'students_remaining - 6',
 * 'min(students_remaining, 6)'.
 */
function resolveConsumesNumber(raw: number | string, ctx: RuleContext, input: RulesAlbumInput): number {
  if (typeof raw === 'number') return raw;
  const scope: EvalScope = {
    ctx,
    input,
    cursors: {},
    range_vars: {},
  };
  return resolveNumber(raw, scope);
}

function cursorsChanged(
  before: Record<string, number>,
  after: Record<string, number>,
): boolean {
  for (const k of Object.keys(after)) {
    if (before[k] !== after[k]) return true;
  }
  return false;
}

// =============================================================================
// 6. computeRulesVersion — детерминированный хэш набора правил
// =============================================================================

function computeRulesVersion(preset: Preset, rules: Rule[]): string {
  // Простой подход: preset.version + max rule version + count.
  // Полноценный хэш — в РЭ.12 (versioning).
  const ruleCount = rules.length;
  const familyVersions = new Set<string>();
  for (const r of rules) familyVersions.add(`${r.family_id}@${r.family_version}`);
  const familyKey = Array.from(familyVersions).sort().join(',');
  return `${preset.version}|${ruleCount}|${familyKey}`;
}
