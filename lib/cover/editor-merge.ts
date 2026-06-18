/**
 * Слияние правок редактора обложек поверх собранных данных (ТЗ tz-cover-editor).
 *
 * Две глубины (как у Сергея):
 *  - ШАБЛОННЫЕ правки на ТИП обложки (cover_type) — тексты/стили/фон/общее фото,
 *    применяются ко всем экземплярам типа;
 *  - ПОШТУЧНЫЙ кроп портрета на УЧЕНИКА (child_id) — поверх шаблонных.
 *
 * Значения — служебные ключи как у разворотов (`__scale__`, `__offset__`,
 * `__color__`, `cover_common_photo` и т.п.). Приоритет: base < type < student.
 */

import type { CoverType } from './types';

export type CoverEditRow = {
  /** Шаблонная правка типа (child_id null). */
  cover_type: CoverType | null;
  /** Поштучная правка ученика (cover_type null). */
  child_id: string | null;
  data: Record<string, string | null>;
};

/** Базовый экземпляр обложки (из assembleCovers). */
export type CoverInstanceLike = {
  child_id: string | null;
  cover_type: CoverType;
  data: Record<string, string | null>;
};

/**
 * Накладывает правки на один экземпляр: data ← base ⊕ type-edits ⊕ student-edits.
 * null в правке трактуется как переопределение значения (в т.ч. очистка).
 */
export function mergeCoverEditsInto<T extends CoverInstanceLike>(
  instance: T,
  editsByType: Record<string, Record<string, string | null>>,
  editsByChild: Record<string, Record<string, string | null>>,
): T {
  const typeEdit = editsByType[instance.cover_type] ?? {};
  const childEdit = instance.child_id ? (editsByChild[instance.child_id] ?? {}) : {};
  return { ...instance, data: { ...instance.data, ...typeEdit, ...childEdit } };
}

/** Раскладывает строки cover_edits в карты по типу и по ученику. */
export function indexCoverEdits(rows: CoverEditRow[]): {
  byType: Record<string, Record<string, string | null>>;
  byChild: Record<string, Record<string, string | null>>;
} {
  const byType: Record<string, Record<string, string | null>> = {};
  const byChild: Record<string, Record<string, string | null>> = {};
  for (const r of rows) {
    if (r.child_id) byChild[r.child_id] = r.data ?? {};
    else if (r.cover_type) byType[r.cover_type] = r.data ?? {};
  }
  return { byType, byChild };
}

/**
 * Из data достаёт placeholderOverrides для холста: ключ `__hidden__<label>`='1'
 * → { [label]: { hidden: true } }. Остальные служебные ключи холст читает сам.
 */
export function hiddenOverridesFromData(
  data: Record<string, string | null>,
): Record<string, { hidden?: boolean }> {
  const out: Record<string, { hidden?: boolean }> = {};
  for (const key of Object.keys(data)) {
    if (key.startsWith('__hidden__') && data[key]) {
      out[key.slice('__hidden__'.length)] = { hidden: true };
    }
  }
  return out;
}
