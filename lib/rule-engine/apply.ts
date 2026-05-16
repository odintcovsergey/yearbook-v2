/**
 * Rule Engine — обработка produces и подстановка bind-выражений.
 *
 * Спецификация: docs/rule-engine-spec.md v1.3 §7.3 (produces), §7.4 (bind).
 *
 * Содержит:
 *   - applyRule — главный entry point. Производит ProducedSpread/ProducedPages
 *     для одного применения правила.
 *   - Хелперы для master selection (параметрический vs строка) и для развёртки
 *     bind-шаблонов в плоский словарь label → value.
 *
 * НЕ содержит:
 *   - Чтения из БД (мастера передаются как Map mastersByName).
 *   - Балансировки (см. balance.ts).
 *   - Логики курсоров (см. build.ts).
 */

import type {
  Bind,
  BindValue,
  MasterRef,
  Produces,
  Rule,
  RuleContext,
  RulesAlbumInput,
} from './types';
import type { SpreadTemplate } from '@/lib/album-builder/types';
import { resolveBoolean, resolveNumber, resolveValue, type EvalScope } from './evaluate';

// =============================================================================
// 1. Выходные типы
// =============================================================================

export interface ProducedPage {
  side: 'left' | 'right' | 'any';
  /** Имя мастера (как в spread_templates.name, регистр сохраняется). */
  master_name: string;
  /** id мастера из spread_templates. Если undefined — мастер не найден. */
  master_id: string | undefined;
  /** Параметры master selector (для параметрических мастеров: slot_count, grid_mode). */
  master_selector_params: Record<string, string | number>;
  /** label → значение (URL/текст/null если placeholder пустой). */
  bindings: Record<string, string | null>;
  /** Список placeholder labels мастера (для balance.ts). */
  master_placeholder_labels: string[];
}

export interface ProducedResult {
  /** type='spread' → оба заполнены; type='page' → только один. */
  left: ProducedPage | null;
  right: ProducedPage | null;
  /**
   * Если мастер сам по себе занимает разворот (is_spread=true в БД, например
   * J-Spread). В MVP правил таких нет, но архитектура заложена.
   */
  is_full_spread_master: boolean;
  /** Список меток-ошибок которые не удалось зарезолвить (для warnings). */
  resolve_errors: string[];
}

// =============================================================================
// 2. applyRule
// =============================================================================

/**
 * Применяет правило: производит ProducedPage(s) с подставленными bindings.
 *
 * @param rule — правило (variants уже выбран, передавать конкретный)
 * @param ctx — контекст (включая section и prev_spread)
 * @param input — полный input альбома
 * @param cursors — курсоры (`$current_student_index`, `$consumed_*`)
 * @param mastersByName — карта мастеров (загружена из БД через loaders)
 */
export function applyRule(
  rule: Rule,
  ctx: RuleContext,
  input: RulesAlbumInput,
  cursors: Record<string, number>,
  mastersByName: Map<string, SpreadTemplate>,
): ProducedResult {
  const errors: string[] = [];
  const produces = rule.produces;

  // sequence type — разворачивается как массив шагов; MVP пока ограничен page/spread.
  if (produces.type === 'sequence') {
    errors.push(`produces.type='sequence' not supported in MVP (rule=${rule.id})`);
    return { left: null, right: null, is_full_spread_master: false, resolve_errors: errors };
  }

  if (produces.type === 'spread') {
    const leftRef = produces.left_master;
    const rightRef = produces.right_master;
    const leftSel = unpackMasterRef(leftRef);
    const rightSel = unpackMasterRef(rightRef);

    const sameName = leftSel.master_name === rightSel.master_name;
    const useLrKeys = sameName || hasLrKeys(rule.bind);

    const leftPage = buildPage(
      'left',
      leftSel,
      rule.bind,
      useLrKeys ? 'left_master' : leftSel.master_name,
      ctx,
      input,
      cursors,
      mastersByName,
      errors,
    );
    const rightPage = buildPage(
      'right',
      rightSel,
      rule.bind,
      useLrKeys ? 'right_master' : rightSel.master_name,
      ctx,
      input,
      cursors,
      mastersByName,
      errors,
    );

    // Если оба мастера одинаковые И мастер в БД отмечен is_spread=true → один мастер на разворот.
    const masterFromDb = mastersByName.get(leftSel.master_name);
    const isFullSpread =
      sameName && masterFromDb !== undefined && masterFromDb.is_spread === true;

    return {
      left: leftPage,
      right: rightPage,
      is_full_spread_master: isFullSpread,
      resolve_errors: errors,
    };
  }

  // produces.type === 'page'
  const sel = unpackMasterRef(produces.master);
  const bindKey = sel.master_name;
  const page = buildPage(
    produces.side,
    sel,
    rule.bind,
    bindKey,
    ctx,
    input,
    cursors,
    mastersByName,
    errors,
  );
  return {
    left: produces.side === 'left' || produces.side === 'any' ? page : null,
    right: produces.side === 'right' ? page : null,
    is_full_spread_master: false,
    resolve_errors: errors,
  };
}

// =============================================================================
// 3. Master selector
// =============================================================================

interface UnpackedMaster {
  master_name: string;
  master_selector_params: Record<string, string | number>;
}

function unpackMasterRef(ref: MasterRef): UnpackedMaster {
  if (typeof ref === 'string') {
    return { master_name: ref, master_selector_params: {} };
  }
  return { master_name: ref.parametric, master_selector_params: ref.params };
}

function hasLrKeys(bind: Rule['bind']): boolean {
  if (!bind) return false;
  return 'left_master' in bind || 'right_master' in bind;
}

// =============================================================================
// 4. buildPage — строит ProducedPage с зарезолвленными bindings
// =============================================================================

function buildPage(
  side: 'left' | 'right' | 'any',
  sel: UnpackedMaster,
  bindAll: Rule['bind'] | undefined,
  bindKey: string,
  ctx: RuleContext,
  input: RulesAlbumInput,
  parentCursors: Record<string, number>,
  mastersByName: Map<string, SpreadTemplate>,
  errors: string[],
): ProducedPage {
  // Резолвим master selector params в числовые курсоры ($slot_count и т.п.)
  const cursorsWithSelector: Record<string, number> = { ...parentCursors };
  for (const k of Object.keys(sel.master_selector_params)) {
    const raw = sel.master_selector_params[k];
    if (typeof raw === 'number') {
      cursorsWithSelector[k] = raw;
      continue;
    }
    // строка — может быть выражением. select_grid_mode возвращает string,
    // но для большинства params (slot_count, grid_mode) ожидаем число.
    const scope: EvalScope = {
      ctx,
      input,
      cursors: cursorsWithSelector,
      range_vars: {},
    };
    try {
      const v = resolveValue(stripExprPrefix(raw), scope);
      if (typeof v === 'number' && Number.isFinite(v)) {
        cursorsWithSelector[k] = v;
        // Также обновляем исходные master_selector_params, чтобы caller видел
        // итоговое числовое значение (а не оригинальное выражение).
        sel.master_selector_params[k] = v;
      } else if (typeof v === 'string') {
        // для grid_mode оставляем строкой, но в cursors класть нельзя — оставим в master_selector_params
        sel.master_selector_params[k] = v;
      }
    } catch (e) {
      errors.push(`master selector param '${k}' eval failed: ${(e as Error).message}`);
    }
  }

  // Найти мастер в БД
  const master = mastersByName.get(sel.master_name);
  const masterId = master?.id;
  const placeholderLabels = master ? master.placeholders.map((p) => p.label) : [];

  // Резолвить bind для этой страницы
  const rawBind: Bind = (bindAll && bindAll[bindKey]) || {};
  const bindings = resolveBind(rawBind, ctx, input, cursorsWithSelector, errors);

  // Заполнить null для placeholder'ов мастера которых нет в bindings
  // (нужно balance.ts'у чтобы знать какие плейсхолдеры остались пустыми)
  for (const label of placeholderLabels) {
    if (!(label in bindings)) bindings[label] = null;
  }

  if (!master) {
    errors.push(`master '${sel.master_name}' not found in template_set`);
  }

  return {
    side,
    master_name: sel.master_name,
    master_id: masterId,
    master_selector_params: sel.master_selector_params,
    bindings,
    master_placeholder_labels: placeholderLabels,
  };
}

function stripExprPrefix(s: string): string {
  // Поддержка нотации '$expr: ...' из spec §7.7.5 — отрезаем префикс.
  const trimmed = s.trim();
  if (trimmed.startsWith('$expr:')) return trimmed.slice('$expr:'.length).trim();
  return trimmed;
}

// =============================================================================
// 5. resolveBind — обходит bind словарь, разворачивает шаблоны
// =============================================================================

function resolveBind(
  bind: Bind,
  ctx: RuleContext,
  input: RulesAlbumInput,
  cursors: Record<string, number>,
  errors: string[],
): Record<string, string | null> {
  const result: Record<string, string | null> = {};

  for (const key of Object.keys(bind)) {
    const value = bind[key];

    // Шаблон параметрический (содержит {i}, {j}, ...) ИЛИ object с params + range
    const isParametric =
      typeof value === 'object' &&
      value !== null &&
      'params' in value &&
      typeof value.params === 'object' &&
      value.params !== null;

    if (isParametric && typeof value === 'object') {
      // Развернуть range
      expandParametric(key, value, ctx, input, cursors, result, errors);
      continue;
    }

    // Простой path (строка) или expr-объект без params
    try {
      const v = resolveOneBindValue(value, ctx, input, cursors, {});
      result[key] = normalizeBindResult(v);
    } catch (e) {
      errors.push(`bind '${key}' eval failed: ${(e as Error).message}`);
      result[key] = null;
    }
  }

  return result;
}

/**
 * Разворачивает параметрический bind-шаблон по range.
 * Пример:
 *   key="studentportrait_{i}",
 *   value={ template: "input.students[$current_student_index + {i} - 1].portrait",
 *           params: { i: { range: [1, 6] } } }
 *   → результат: 6 пар (studentportrait_1..6).
 */
function expandParametric(
  keyTemplate: string,
  value: Extract<BindValue, { template?: string }>,
  ctx: RuleContext,
  input: RulesAlbumInput,
  cursors: Record<string, number>,
  result: Record<string, string | null>,
  errors: string[],
): void {
  // skip_if проверяется один раз для всего параметрического bind'а
  const baseScope: EvalScope = { ctx, input, cursors, range_vars: {} };
  if (typeof value === 'object' && value.skip_if) {
    try {
      if (resolveBoolean(value.skip_if, baseScope)) return;
    } catch (e) {
      errors.push(`bind skip_if eval failed: ${(e as Error).message}`);
      return;
    }
  }

  // Определить range для каждого параметра (i, j, ...).
  const paramsObj = (value.params || {}) as Record<string, unknown>;
  const ranges: Array<{ name: string; from: number; to: number }> = [];
  for (const pname of Object.keys(paramsObj)) {
    const pv = paramsObj[pname];
    if (
      pv !== null &&
      typeof pv === 'object' &&
      Array.isArray((pv as { range?: unknown }).range)
    ) {
      const rng = (pv as { range: [unknown, unknown] }).range;
      const from = resolveBoundary(rng[0], baseScope);
      const to = resolveBoundary(rng[1], baseScope);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        errors.push(
          `bind '${keyTemplate}': range bound non-numeric (from=${rng[0]} to=${rng[1]})`,
        );
        return;
      }
      ranges.push({ name: pname, from, to });
    } else {
      // Литерал — фиксированное значение (одна итерация)
      const num = Number(pv);
      if (Number.isFinite(num)) {
        ranges.push({ name: pname, from: num, to: num });
      }
    }
  }

  // В MVP поддерживаем одну переменную range. Если больше — берём первую,
  // остальные пробрасываем как фиксированные.
  if (ranges.length === 0) {
    errors.push(`bind '${keyTemplate}': no range params`);
    return;
  }

  const primary = ranges[0];
  if (primary.to < primary.from) return; // пустой range — ничего не делаем

  const tmpl = typeof value === 'object' ? value.template : undefined;
  const expr = typeof value === 'object' ? value.expr : undefined;

  for (let i = primary.from; i <= primary.to; i++) {
    const rangeVars: Record<string, number> = { [primary.name]: i };
    // Зафиксированные другие переменные range
    for (let j = 1; j < ranges.length; j++) {
      rangeVars[ranges[j].name] = ranges[j].from;
    }

    // Подставить {i} в keyTemplate
    const concreteKey = substituteRangeInString(keyTemplate, rangeVars);

    const scope: EvalScope = { ctx, input, cursors, range_vars: rangeVars };
    try {
      let resolved: unknown;
      if (tmpl !== undefined) {
        resolved = resolveValue(tmpl, scope);
      } else if (expr !== undefined) {
        resolved = resolveValue(expr, scope);
      } else {
        resolved = null;
      }
      result[concreteKey] = normalizeBindResult(resolved);
    } catch (e) {
      errors.push(`bind '${concreteKey}' eval failed: ${(e as Error).message}`);
      result[concreteKey] = null;
    }
  }
}

/**
 * Подставляет {name} → значение из rangeVars в строке.
 * Используется для генерации конкретных placeholder labels.
 */
function substituteRangeInString(
  s: string,
  rangeVars: Record<string, number>,
): string {
  return s.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(rangeVars, name)) {
      return String(rangeVars[name]);
    }
    return `{${name}}`;
  });
}

/**
 * Резолвит одно значение из bind. Поддерживает:
 *   - string (path)
 *   - { expr: ... }
 *   - { template: ..., skip_if?: ... } без params (как простой template)
 */
function resolveOneBindValue(
  value: BindValue,
  ctx: RuleContext,
  input: RulesAlbumInput,
  cursors: Record<string, number>,
  rangeVars: Record<string, number>,
): unknown {
  const scope: EvalScope = { ctx, input, cursors, range_vars: rangeVars };
  if (typeof value === 'string') {
    return resolveValue(value, scope);
  }
  if (value && typeof value === 'object') {
    if (value.skip_if && resolveBoolean(value.skip_if, scope)) {
      return null;
    }
    if (value.expr !== undefined) {
      return resolveValue(value.expr, scope);
    }
    if (value.template !== undefined) {
      return resolveValue(value.template, scope);
    }
  }
  return null;
}

/**
 * Резолвит границу range. Может быть:
 *   - number — буквальное число
 *   - string — выражение (`subjects_count`, `students_remaining`, `$slot_count`,
 *              `students_remaining - 6` и т.д.)
 */
function resolveBoundary(raw: unknown, scope: EvalScope): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    return resolveNumber(raw, scope);
  }
  return NaN;
}

/**
 * Приводит результат bind к { string | null }:
 *   - null/undefined → null
 *   - boolean false / 0 / '' → null (placeholder будет считаться пустым)
 *   - всё остальное → String(v)
 *
 * Замечание: если резолвинг возвращает пустую строку (например text-плейсхолдер
 * без значения), это null. Это согласуется с тем, что balance.ts использует
 * `null` как маркер «слот пустой».
 */
function normalizeBindResult(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v === '') return null;
  if (v === false) return null;
  // 0 как число — оставляем (может быть номер класса, например)
  return String(v);
}
