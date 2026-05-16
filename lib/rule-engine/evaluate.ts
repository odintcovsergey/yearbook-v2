/**
 * Rule Engine — интерпретатор выражений и when-clause.
 *
 * Спецификация: docs/rule-engine-spec.md v1.3 §7.2 (when), §7.4 (bind),
 * §7.5 (consumes), §9 (контекст вычисления).
 *
 * Содержит:
 *   - evaluateWhen — проверка when-clause правила против контекста
 *   - resolveValue — резолвинг bind-выражения в значение (URL, текст, число, null)
 *   - resolveNumber — резолвинг числового выражения (для consumes, range)
 *   - resolveBoolean — резолвинг boolean (skip_if, conditional)
 *
 * Все выражения парсятся собственным мини-парсером, БЕЗ использования
 * `Function`/`eval`. Поддерживаются операции:
 *   - литералы: number, string ('...'), true, false, null
 *   - пути: `input.head_teacher.photo`, `input.students[$idx].portrait`
 *   - переменные: `$current_student_index`, `$slot_count`, `{i}`, `{j}`
 *   - арифметика: `+`, `-`, `*`, `/`, `%`
 *   - сравнения: `==`, `!=`, `<`, `<=`, `>`, `>=`
 *   - логика: `&&`, `||`, `!`
 *   - тернарный: `a ? b : c`
 *   - nullish: `a ?? b`
 *   - функции: `min(a, b)`, `max(a, b)`
 *   - методы массива: `arr.last()`
 */

import type {
  WhenClause,
  WhenOperator,
  RuleContext,
  RulesAlbumInput,
} from './types';

// =============================================================================
// 1. Контекст резолвинга
// =============================================================================

/**
 * Расширенный контекст для resolveValue / resolveBoolean / resolveNumber.
 *
 * `cursors` — переменные с префиксом `$`:
 *   - $current_student_index
 *   - $consumed_full_class / $consumed_half_class / $consumed_spread /
 *     $consumed_quarter / $consumed_sixth
 *   - $slot_count — параметр текущего master selector'а (если применимо)
 *
 * `range_vars` — переменные `{i}`, `{j}` подставляемые при разворачивании
 * параметрического template'а в `apply.ts`.
 */
export interface EvalScope {
  /** Контекст для when-проверок (включая section/prev_spread). */
  ctx: RuleContext;
  /** Полный input альбома (для path-обращений `input.X.Y`). */
  input: RulesAlbumInput;
  /** Числовые курсоры и параметры master selector (`$current_student_index`, `$slot_count`). */
  cursors: Record<string, number>;
  /** Параметры range (`{i}`, `{j}`). Пустой объект если не в range. */
  range_vars: Record<string, number>;
}

// =============================================================================
// 2. evaluateWhen — проверка условия правила или секции
// =============================================================================

/**
 * Проверяет when-clause против контекста.
 * Все поля when объединяются по AND.
 */
export function evaluateWhen(when: WhenClause, ctx: RuleContext): boolean {
  for (const field of Object.keys(when)) {
    const op = when[field];
    const actual = readContextField(ctx, field);
    if (!matchOperator(actual, op)) return false;
  }
  return true;
}

/**
 * Читает поле контекста по строковому пути (например 'common_photos.half_class.count').
 * Возвращает undefined если путь не найден.
 */
function readContextField(ctx: RuleContext, field: string): unknown {
  const parts = field.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  // Спец-случай: `common_photos.X.has_any` — если в RuleContext поле опциональное,
  // и при этом `count > 0` → считаем true.
  if (cur === undefined && field.endsWith('.has_any')) {
    const countField = field.replace(/\.has_any$/, '.count');
    const cnt = readContextField(ctx, countField);
    if (typeof cnt === 'number') return cnt > 0;
  }
  return cur;
}

/**
 * Сравнивает фактическое значение с оператором when.
 */
function matchOperator(actual: unknown, op: WhenOperator): boolean {
  // Литерал (number/string/boolean) — эквивалент {eq}
  if (op === null || typeof op !== 'object') {
    return deepEq(actual, op);
  }

  // {eq}
  if ('eq' in op) return deepEq(actual, op.eq);
  // {neq}
  if ('neq' in op) return !deepEq(actual, op.neq);

  // {gte}/{lte}/{gt}/{lt}
  if ('gte' in op) return typeof actual === 'number' && actual >= op.gte;
  if ('lte' in op) return typeof actual === 'number' && actual <= op.lte;
  if ('gt' in op) return typeof actual === 'number' && actual > op.gt;
  if ('lt' in op) return typeof actual === 'number' && actual < op.lt;

  // {between}
  if ('between' in op) {
    return (
      typeof actual === 'number' && actual >= op.between[0] && actual <= op.between[1]
    );
  }

  // {in}/{not_in}
  if ('in' in op) return op.in.some((v) => deepEq(actual, v));
  if ('not_in' in op) return !op.not_in.some((v) => deepEq(actual, v));

  // {has: true/false}
  if ('has' in op) {
    const present =
      actual !== undefined &&
      actual !== null &&
      actual !== '' &&
      actual !== 0 &&
      !(Array.isArray(actual) && actual.length === 0);
    return op.has ? present : !present;
  }

  // {count_gte}/{count_lte}/{count_between}
  if ('count_gte' in op) {
    return Array.isArray(actual) && actual.length >= op.count_gte;
  }
  if ('count_lte' in op) {
    return Array.isArray(actual) && actual.length <= op.count_lte;
  }
  if ('count_between' in op) {
    return (
      Array.isArray(actual) &&
      actual.length >= op.count_between[0] &&
      actual.length <= op.count_between[1]
    );
  }

  return false;
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // 1 === true / 0 === false НЕ считаем равными
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

// =============================================================================
// 3. Резолвинг bind-выражений (главные API)
// =============================================================================

/**
 * Резолвит bind-выражение (path или expr) в любое значение.
 * Используется для подстановки в bindings мастера.
 *
 * Возвращает:
 *   - string (URL фото, текст, ФИО) — если путь резолвится в строку
 *   - number — если выражение арифметическое
 *   - boolean — если выражение логическое
 *   - null — если путь обрывается / выражение возвращает null
 */
export function resolveValue(expr: string, scope: EvalScope): unknown {
  const prepared = preprocessExpr(expr, scope);
  return evalExpr(prepared, scope);
}

/**
 * Резолвит выражение в число. Возвращает NaN если результат не число.
 * Используется для consumes (number или string-expr) и для границ range.
 */
export function resolveNumber(expr: string | number, scope: EvalScope): number {
  if (typeof expr === 'number') return expr;
  const v = resolveValue(expr, scope);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Резолвит выражение в boolean. Любое truthy значение → true.
 */
export function resolveBoolean(expr: string, scope: EvalScope): boolean {
  const v = resolveValue(expr, scope);
  return !!v;
}

// =============================================================================
// 4. Препроцессинг — подстановка {i} и $vars в строку выражения
// =============================================================================

/**
 * Заменяет `{i}`, `{j}` на конкретные числовые значения из range_vars.
 * Затем заменяет `$varname` на числовые значения из cursors.
 *
 * Возвращает «голое» выражение без подстановок, готовое к парсингу.
 */
function preprocessExpr(expr: string, scope: EvalScope): string {
  // {i}, {j}, {k}, ...
  let out = expr.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(scope.range_vars, name)) {
      return String(scope.range_vars[name]);
    }
    return `{${name}}`; // не подставлен — оставляем (будет ошибка парсинга)
  });
  // $varname
  out = out.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(scope.cursors, name)) {
      return String(scope.cursors[name]);
    }
    return '0'; // неизвестная курсор-переменная → 0 (graceful degradation)
  });
  return out;
}

// =============================================================================
// 5. Мини-парсер выражений (Pratt-style, без eval)
// =============================================================================

interface Token {
  kind:
    | 'num'
    | 'str'
    | 'ident'
    | 'punct'
    | 'op'
    | 'true'
    | 'false'
    | 'null';
  value: string;
}

/**
 * Токенайзер. Простой: пропускает whitespace, читает числа/строки/идентификаторы/
 * операторы (?? || && == != <= >= < > + - * / % ! ? : , . [ ] ( )).
 */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // numbers
    if ((ch >= '0' && ch <= '9') || (ch === '-' && i + 1 < src.length && src[i + 1] >= '0' && src[i + 1] <= '9' && (out.length === 0 || isPrefixOp(out[out.length - 1])))) {
      let j = i;
      if (src[j] === '-') j++;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      out.push({ kind: 'num', value: src.slice(i, j) });
      i = j;
      continue;
    }

    // strings: '...' or "..."
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let acc = '';
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < src.length) {
          acc += src[j + 1];
          j += 2;
        } else {
          acc += src[j];
          j++;
        }
      }
      out.push({ kind: 'str', value: acc });
      i = j + 1;
      continue;
    }

    // identifiers / keywords
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let j = i;
      while (
        j < src.length &&
        ((src[j] >= 'a' && src[j] <= 'z') ||
          (src[j] >= 'A' && src[j] <= 'Z') ||
          (src[j] >= '0' && src[j] <= '9') ||
          src[j] === '_')
      ) {
        j++;
      }
      const word = src.slice(i, j);
      if (word === 'true') out.push({ kind: 'true', value: word });
      else if (word === 'false') out.push({ kind: 'false', value: word });
      else if (word === 'null') out.push({ kind: 'null', value: word });
      else out.push({ kind: 'ident', value: word });
      i = j;
      continue;
    }

    // 2-char operators
    const two = src.slice(i, i + 2);
    if (two === '??' || two === '||' || two === '&&' || two === '==' || two === '!=' || two === '<=' || two === '>=') {
      out.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }

    // 1-char punctuation/operators
    if ('+-*/%!?:,.[]()<>'.indexOf(ch) >= 0) {
      out.push({ kind: ch === '?' || ch === ':' || ch === '!' || ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '<' || ch === '>' ? 'op' : 'punct', value: ch });
      i++;
      continue;
    }

    throw new Error(`tokenize: unexpected char '${ch}' at ${i} in expression "${src}"`);
  }
  return out;
}

function isPrefixOp(t: Token): boolean {
  if (t.kind === 'op') return true;
  if (t.kind === 'punct' && (t.value === ',' || t.value === '[' || t.value === '(')) return true;
  return false;
}

/**
 * Парсер. Возвращает AST минимально — мы сразу его и интерпретируем.
 * Для простоты используем рекурсивный спуск с precedence climbing.
 *
 * Приоритеты (от низшего к высшему):
 *   0: тернарный  ?:
 *   1: ??
 *   2: ||
 *   3: &&
 *   4: == !=
 *   5: < <= > >=
 *   6: + -
 *   7: * / %
 *   8: унарный ! -
 *   9: вызов / индексация / member (a.b, a[expr], a())
 *   10: атом
 */

interface ParserState {
  tokens: Token[];
  pos: number;
}

function peek(p: ParserState): Token | undefined {
  return p.tokens[p.pos];
}

function consume(p: ParserState): Token {
  const t = p.tokens[p.pos];
  p.pos++;
  return t;
}

function isOp(t: Token | undefined, ...vals: string[]): boolean {
  if (!t) return false;
  if (t.kind !== 'op' && t.kind !== 'punct') return false;
  return vals.indexOf(t.value) >= 0;
}

/**
 * Главный entry point — вычисляет AST в значение.
 */
function evalExpr(expr: string, scope: EvalScope): unknown {
  if (expr.trim() === '') return null;
  const tokens = tokenize(expr);
  const state: ParserState = { tokens, pos: 0 };
  const v = parseTernary(state, scope);
  if (state.pos < tokens.length) {
    throw new Error(
      `parse: unconsumed tokens at ${state.pos} in "${expr}" (next='${tokens[state.pos].value}')`,
    );
  }
  return v;
}

// 0. ternary
function parseTernary(p: ParserState, scope: EvalScope): unknown {
  const cond = parseNullish(p, scope);
  if (isOp(peek(p), '?')) {
    consume(p);
    const a = parseTernary(p, scope);
    if (!isOp(peek(p), ':')) {
      throw new Error(`parse: expected ':' in ternary at ${p.pos}`);
    }
    consume(p);
    const b = parseTernary(p, scope);
    return cond ? a : b;
  }
  return cond;
}

// 1. ??
function parseNullish(p: ParserState, scope: EvalScope): unknown {
  let left = parseLogicalOr(p, scope);
  while (isOp(peek(p), '??')) {
    consume(p);
    const right = parseLogicalOr(p, scope);
    left = left === null || left === undefined ? right : left;
  }
  return left;
}

// 2. ||
function parseLogicalOr(p: ParserState, scope: EvalScope): unknown {
  let left = parseLogicalAnd(p, scope);
  while (isOp(peek(p), '||')) {
    consume(p);
    const right = parseLogicalAnd(p, scope);
    left = left || right;
  }
  return left;
}

// 3. &&
function parseLogicalAnd(p: ParserState, scope: EvalScope): unknown {
  let left = parseEquality(p, scope);
  while (isOp(peek(p), '&&')) {
    consume(p);
    const right = parseEquality(p, scope);
    left = left && right;
  }
  return left;
}

// 4. == !=
function parseEquality(p: ParserState, scope: EvalScope): unknown {
  let left = parseComparison(p, scope);
  while (isOp(peek(p), '==', '!=')) {
    const op = consume(p).value;
    const right = parseComparison(p, scope);
    left = op === '==' ? deepEq(left, right) : !deepEq(left, right);
  }
  return left;
}

// 5. < <= > >=
function parseComparison(p: ParserState, scope: EvalScope): unknown {
  let left = parseAdditive(p, scope);
  while (isOp(peek(p), '<', '<=', '>', '>=')) {
    const op = consume(p).value;
    const right = parseAdditive(p, scope);
    const ln = Number(left);
    const rn = Number(right);
    if (op === '<') left = ln < rn;
    else if (op === '<=') left = ln <= rn;
    else if (op === '>') left = ln > rn;
    else left = ln >= rn;
  }
  return left;
}

// 6. + -
function parseAdditive(p: ParserState, scope: EvalScope): unknown {
  let left = parseMultiplicative(p, scope);
  while (isOp(peek(p), '+', '-')) {
    const op = consume(p).value;
    const right = parseMultiplicative(p, scope);
    if (op === '+') {
      if (typeof left === 'string' || typeof right === 'string') {
        left = String(left ?? '') + String(right ?? '');
      } else {
        left = Number(left) + Number(right);
      }
    } else {
      left = Number(left) - Number(right);
    }
  }
  return left;
}

// 7. * / %
function parseMultiplicative(p: ParserState, scope: EvalScope): unknown {
  let left = parseUnary(p, scope);
  while (isOp(peek(p), '*', '/', '%')) {
    const op = consume(p).value;
    const right = parseUnary(p, scope);
    const ln = Number(left);
    const rn = Number(right);
    if (op === '*') left = ln * rn;
    else if (op === '/') left = ln / rn;
    else left = ln % rn;
  }
  return left;
}

// 8. unary ! -
function parseUnary(p: ParserState, scope: EvalScope): unknown {
  if (isOp(peek(p), '!')) {
    consume(p);
    const v = parseUnary(p, scope);
    return !v;
  }
  if (isOp(peek(p), '-')) {
    consume(p);
    const v = parseUnary(p, scope);
    return -Number(v);
  }
  return parsePostfix(p, scope);
}

// 9. postfix: member access, indexing, function call
function parsePostfix(p: ParserState, scope: EvalScope): unknown {
  let val = parseAtom(p, scope);
  let chainedAsLastMethod = false;
  for (;;) {
    const t = peek(p);
    if (!t) break;
    // .ident — member access
    if (isOp(t, '.')) {
      consume(p);
      const nameTok = consume(p);
      if (nameTok.kind !== 'ident') {
        throw new Error(`parse: expected identifier after '.', got '${nameTok.value}'`);
      }
      // method call: .last()
      const next = peek(p);
      if (next && isOp(next, '(')) {
        consume(p);
        // no args supported for last()
        if (!isOp(peek(p), ')')) {
          throw new Error(`parse: expected ')' after method '${nameTok.value}('`);
        }
        consume(p);
        if (nameTok.value === 'last') {
          if (Array.isArray(val)) val = val.length > 0 ? val[val.length - 1] : null;
          else val = null;
        } else {
          throw new Error(`parse: unknown method '${nameTok.value}'`);
        }
        chainedAsLastMethod = true;
        continue;
      }
      val = readMember(val, nameTok.value);
      chainedAsLastMethod = false;
      continue;
    }
    // [ expr ] — index access
    if (isOp(t, '[')) {
      consume(p);
      const idx = parseTernary(p, scope);
      if (!isOp(peek(p), ']')) {
        throw new Error(`parse: expected ']' after index expr`);
      }
      consume(p);
      val = readIndex(val, idx);
      chainedAsLastMethod = false;
      continue;
    }
    break;
  }
  void chainedAsLastMethod;
  return val;
}

// 10. atom
function parseAtom(p: ParserState, scope: EvalScope): unknown {
  const t = peek(p);
  if (!t) throw new Error(`parse: unexpected end of expression`);

  if (t.kind === 'num') {
    consume(p);
    return Number(t.value);
  }
  if (t.kind === 'str') {
    consume(p);
    return t.value;
  }
  if (t.kind === 'true') {
    consume(p);
    return true;
  }
  if (t.kind === 'false') {
    consume(p);
    return false;
  }
  if (t.kind === 'null') {
    consume(p);
    return null;
  }
  if (isOp(t, '(')) {
    consume(p);
    const v = parseTernary(p, scope);
    if (!isOp(peek(p), ')')) {
      throw new Error(`parse: expected ')'`);
    }
    consume(p);
    return v;
  }
  if (t.kind === 'ident') {
    consume(p);
    // function call? min(...), max(...)
    if (isOp(peek(p), '(')) {
      consume(p);
      const args: unknown[] = [];
      if (!isOp(peek(p), ')')) {
        args.push(parseTernary(p, scope));
        while (isOp(peek(p), ',')) {
          consume(p);
          args.push(parseTernary(p, scope));
        }
      }
      if (!isOp(peek(p), ')')) {
        throw new Error(`parse: expected ')' after function args`);
      }
      consume(p);
      return callFunction(t.value, args);
    }
    return readIdentifierRoot(t.value, scope);
  }

  throw new Error(`parse: unexpected token '${t.value}' (kind=${t.kind})`);
}

/**
 * Резолвит корневой идентификатор (input, section, prev_spread, head_teacher,
 * subjects_count, students_remaining и т.п.) в значение.
 */
function readIdentifierRoot(name: string, scope: EvalScope): unknown {
  if (name === 'input') return scope.input;
  if (name === 'section') return scope.ctx.section;
  if (name === 'prev_spread') return scope.ctx.prev_spread;
  if (name === 'head_teacher') return scope.ctx.head_teacher;
  if (name === 'common_photos') return scope.ctx.common_photos;
  // числовые поля контекста
  if (name === 'subjects_count') return scope.ctx.subjects_count;
  if (name === 'students_count') return scope.ctx.students_count;
  if (name === 'students_remaining') return scope.ctx.students_remaining;
  if (name === 'current_student_index') return scope.ctx.current_student_index;
  if (name === 'print_type') return scope.ctx.print_type;
  if (name === 'friend_photos_count') return scope.ctx.friend_photos_count ?? 0;
  // курсоры тоже как идентификаторы (если кто-то напишет `current_student_index` без $)
  if (Object.prototype.hasOwnProperty.call(scope.cursors, name)) {
    return scope.cursors[name];
  }
  // range_vars без `{}` обертки
  if (Object.prototype.hasOwnProperty.call(scope.range_vars, name)) {
    return scope.range_vars[name];
  }
  return undefined;
}

function readMember(obj: unknown, name: string): unknown {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  if (!(name in o)) return undefined;
  return o[name];
}

function readIndex(obj: unknown, idx: unknown): unknown {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    const n = Number(idx);
    if (!Number.isFinite(n) || n < 0 || n >= obj.length) return null;
    return obj[n];
  }
  if (typeof obj === 'object') {
    return (obj as Record<string, unknown>)[String(idx)];
  }
  return undefined;
}

function callFunction(name: string, args: unknown[]): unknown {
  if (name === 'min') {
    const nums = args.map(Number).filter((x) => Number.isFinite(x));
    if (nums.length === 0) return null;
    let m = nums[0];
    for (let i = 1; i < nums.length; i++) if (nums[i] < m) m = nums[i];
    return m;
  }
  if (name === 'max') {
    const nums = args.map(Number).filter((x) => Number.isFinite(x));
    if (nums.length === 0) return null;
    let m = nums[0];
    for (let i = 1; i < nums.length; i++) if (nums[i] > m) m = nums[i];
    return m;
  }
  if (name === 'select_grid_mode') {
    // Заложено в spec §7.7.5 как $expr: select_grid_mode(students_remaining).
    // MVP: возвращаем имя режима 'grid_N' где N = первый аргумент.
    const n = Number(args[0]);
    return Number.isFinite(n) ? `grid_${n}` : null;
  }
  throw new Error(`evaluate: unknown function '${name}'`);
}
