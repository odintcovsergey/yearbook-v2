/**
 * Чистые helpers для album-builder. Никаких сторонних импортов.
 *
 * Ограничения tsconfig (target=es5, без downlevelIteration —
 * см. idml-recon §6 и memory `feedback_no_void_unused`):
 * - не использовать spread на итераторах (`[...mapValues]`)
 * - не делать for-of по итераторам Map/Set
 * - использовать `for (let i = 0; ...)` или `Array.prototype.*`
 */

import type { BuildContext, BuildWarning } from './types';

/**
 * Разбить массив на куски размера `size`. Последний кусок может быть короче.
 *
 * @throws если `size <= 0` — это всегда ошибка вызывающего, не данных.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error(`chunk: size must be > 0, got ${size}`);
  }
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Маркер исчерпывающей проверки в switch по discriminated union.
 * Если в switch добавили новый вариант и не обработали — TS подсветит,
 * что `x` не имеет типа `never`, а в рантайме упадёт с понятной ошибкой.
 */
export function assertExhaustive(x: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(x)}`);
}

/**
 * Добавить warning в контекст. Минимальный логгер — реальное использование
 * появится в 0.10 (резолвер мастеров, сборка секций).
 */
export function pushWarning(ctx: BuildContext, w: BuildWarning): void {
  ctx.warnings.push(w);
}
