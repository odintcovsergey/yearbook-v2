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

/**
 * Метки-СОДЕРЖИМОЕ, которые ЛИЧНЫЕ для каждого ученика (а не общие на тип
 * обложки): имя выпускника и класс. Их значение берётся из данных ученика
 * (fillCoverData) и правится поштучно (scope='student'). Поэтому при слиянии
 * НЕ применяем такие ключи из шаблонной (type) правки — иначе одно введённое
 * имя перекрыло бы имена ВСЕХ учеников типа «Портрет».
 *
 * ВАЖНО: это только КОНТЕНТ (сам текст). Служебные ключи стиля
 * (__fontSize__cover_student_name и т.п.) остаются общими на тип — все имена
 * выглядят одинаково.
 */
export const PER_STUDENT_COVER_LABELS = ['cover_student_name', 'cover_class'] as const;

/** Убирает личные метки-контент из шаблонной (type) правки. */
function stripPerStudentContent(
  typeEdit: Record<string, string | null>,
): Record<string, string | null> {
  const out = { ...typeEdit };
  for (const lbl of PER_STUDENT_COVER_LABELS) delete out[lbl];
  return out;
}

/**
 * Слияние данных обложки: base ⊕ type ⊕ student. Личные метки-контент
 * (имя/класс) из type-слоя выкидываются (см. PER_STUDENT_COVER_LABELS).
 * Единая точка слияния — используется и сборкой, и редактором (live-патчи).
 */
export function mergeCoverData(
  base: Record<string, string | null>,
  typePatch: Record<string, string | null>,
  studentPatch: Record<string, string | null>,
): Record<string, string | null> {
  return { ...base, ...stripPerStudentContent(typePatch), ...studentPatch };
}

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
  return { ...instance, data: mergeCoverData(instance.data, typeEdit, childEdit) };
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
 * Служебный ключ ручной смены фона обложки. Значение — URL картинки фона
 * (перекрывает фон мастера `covers.background_url`), либо `'none'` — явное «без
 * фона» (тоже перекрывает мастер). Отсутствие ключа = фон мастера.
 */
export const COVER_BG_KEY = '__bg__';

/** Сентинел «без фона» в значении `__bg__`. */
export const COVER_BG_NONE = 'none';

/**
 * Эффективный фон обложки: правка `__bg__` из data перекрывает фон мастера.
 *  - `__bg__` = URL  → этот URL;
 *  - `__bg__` = 'none' → null (явно без фона);
 *  - ключа нет        → фон мастера (masterBgUrl).
 */
export function resolveCoverBackground(
  data: Record<string, string | null> | undefined,
  masterBgUrl: string | null | undefined,
): string | null {
  const ov = data?.[COVER_BG_KEY];
  if (ov === undefined || ov === null) return masterBgUrl ?? null;
  if (ov === COVER_BG_NONE || ov === '') return null;
  return ov;
}

/**
 * Переезд на Timeweb: превратить значение фона в показываемый URL.
 *  - пусто → null;
 *  - есть запись в карте bgSigned → она (сервер пере-подписал значение —
 *    покрывает и относительные ключи, и протухшие полные URL: старый supabase
 *    или просроченный presigned, которые иначе вернулись бы как есть → 404);
 *  - иначе значение как есть (supabase-режим: карта пустая, клиент строит
 *    публичный URL выше по стеку; либо незнакомый ключ — лучше пусть будет он).
 *
 * ВАЖНО: карту проверяем ПЕРВОЙ, ДО проверки на http — старые __bg__ хранят
 * полный supabase-URL, и ранний возврат http-URL отдавал мёртвую ссылку.
 */
export function signCoverBg(
  url: string | null,
  bgSigned: Record<string, string> | null | undefined,
): string | null {
  if (!url) return null;
  return bgSigned?.[url] || url;
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
