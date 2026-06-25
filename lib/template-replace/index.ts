/**
 * lib/template-replace — умное автозаполнение при смене мастера (Р.1).
 *
 * Когда партнёр через TemplatePickerModal заменяет мастер разворота,
 * нужно перенести значения placeholder'ов (фото и текст) из старого
 * мастера в новый. До Р.1 это делалось по точному совпадению `label` —
 * если в старом мастере был `studentphoto1`, а в новом `photo_1`, всё
 * значение терялось.
 *
 * Здесь реализован каскад стратегий сопоставления (от строгой к мягкой):
 *
 *   1. EXACT       — точное совпадение label + совпадение type
 *                    (только тогда можно мигрировать __hidden__/__pos__)
 *   2. NORMALIZED  — совпадение нормализованного label + совпадение type
 *                    (lowercase + удалить non-alphanumeric:
 *                     `student_photo_1` ≈ `studentphoto1` ≈ `Student Photo 1`)
 *   3. BY_TYPE     — по типу placeholder с сохранением исходного порядка
 *                    (оставшиеся unmatched-фото из старого → свободные
 *                     photo-слоты нового по порядку появления в массиве
 *                     placeholders)
 *
 * Каждый old-label используется не более одного раза. Если для нового
 * placeholder'а ни одна стратегия не сработала — слот остаётся null.
 *
 * Служебные ключи (зашиты в data, но не относятся к placeholder'ам как
 * к рамкам):
 *
 *   - __scale__<label>   — масштаб фото (КЭ)
 *   - __offset__<label>  — смещение фото (КЭ)
 *   - __rotate__<label>  — поворот фото (Р.2, зарезервировано)
 *   - __fontSize__<label> — мультипликатор размера текста (Р.3, зарезервировано)
 *   - __color__<label>   — override цвета текста (Р.3, зарезервировано)
 *     Эти ключи относятся к содержимому (cropping фото, стиль текста)
 *     и мигрируют ВМЕСТЕ с содержимым в новый label при любой стратегии
 *     сопоставления.
 *
 *   - __hidden__<label>  — балансировка (скрытие placeholder'а)
 *   - __pos__<label>     — балансировка (переразмещение placeholder'а)
 *     Эти ключи относятся к РАМКАМ конкретного мастера. После смены
 *     мастера старая балансировка не имеет смысла — отбрасываем
 *     (даже при EXACT-сопоставлении, чтобы новый мастер не унаследовал
 *     старые искусственные позиции).
 */

import type { Placeholder } from '@/lib/album-builder/types';

// ─── Префиксы служебных ключей ──────────────────────────────────────────

/**
 * Служебные ключи, относящиеся к содержимому слота (фото/текст).
 * Мигрируют вместе со значением при переносе на новый label.
 */
const CONTENT_KEY_PREFIXES = [
  '__scale__',
  '__offset__',
  '__rotate__',
  '__fontSize__',
  '__color__',
] as const;

/**
 * Служебные ключи балансировки. Относятся к рамкам конкретного мастера —
 * после смены мастера отбрасываются.
 */
const BALANCE_KEY_PREFIXES = ['__hidden__', '__pos__'] as const;

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Статистика remap'а — какие слоты как сопоставлены. Используется для
 * UX (показать партнёру что переехало, что потерялось) и для тестов.
 */
export type RemapStats = {
  /** Точное совпадение label + type. */
  exact: number;
  /** Совпадение нормализованного label + type. */
  normalized: number;
  /** Совпадение по типу с сохранением порядка. */
  byType: number;
  /** Старых значений не нашлось куда положить (фото или текст). */
  lost: number;
  /** Детальный список потерянных слотов (label из старого мастера). */
  lostLabels: string[];
};

export type RemapResult = {
  /** Новый data объект для новой spread instance. */
  newData: Record<string, string | null>;
  /** Статистика. */
  stats: RemapStats;
};

/**
 * Пересоберает data разворота при смене мастера.
 *
 * @param oldData          spread.data старого инстанса (с __scale__/__offset__ и т.п.)
 * @param oldPlaceholders  placeholders старого мастера (для определения типа каждого label)
 * @param newPlaceholders  placeholders нового мастера
 * @param contentKeyPrefixes какие служебные ключи переносить на новый label.
 *        По умолчанию — CONTENT_KEY_PREFIXES (смена мастера через
 *        TemplatePickerModal: кропы + стили). Смена ДИЗАЙНА передаёт только
 *        кропы (`__scale__/__offset__/__rotate__`), чтобы стили взялись из
 *        нового дизайна (см. lib/design-switch). Не входящие в список ключи
 *        отбрасываются.
 */
export function remapData(
  oldData: Record<string, string | null>,
  oldPlaceholders: Placeholder[],
  newPlaceholders: Placeholder[],
  contentKeyPrefixes: readonly string[] = CONTENT_KEY_PREFIXES,
): RemapResult {
  // ─── Стейт прохода ────────────────────────────────────────────────
  const newData: Record<string, string | null> = {};
  const stats: RemapStats = {
    exact: 0,
    normalized: 0,
    byType: 0,
    lost: 0,
    lostLabels: [],
  };

  // Карта label → placeholder для старого мастера (для определения type)
  const oldByLabel = new Map<string, Placeholder>();
  for (const ph of oldPlaceholders) {
    oldByLabel.set(ph.label, ph);
  }

  // Список «контентных» (не служебных) values из oldData, оставленных
  // в порядке появления placeholder'ов в массиве oldPlaceholders.
  // Только labels из oldPlaceholders (служебные ключи фильтруются).
  // Берём только те, у которых есть placeholder тех же типа (защита от
  // мусора в data — bывает в legacy-данных).
  type OldEntry = {
    label: string;
    value: string | null;
    type: 'photo' | 'text';
  };
  const oldEntries: OldEntry[] = oldPlaceholders.map((ph) => ({
    label: ph.label,
    value: oldData[ph.label] ?? null,
    type: ph.type,
  }));

  // used: какие old-labels уже забрали в новый слот.
  const used = new Set<string>();

  // Helper: попытка взять значение из old по label.
  // Возвращает старый OldEntry если он ещё не used и тип совпадает.
  function takeByLabel(
    label: string,
    expectedType: 'photo' | 'text',
  ): OldEntry | null {
    if (used.has(label)) return null;
    const ph = oldByLabel.get(label);
    if (!ph) return null;
    if (ph.type !== expectedType) return null;
    const entry = oldEntries.find((e) => e.label === label);
    if (!entry) return null;
    used.add(label);
    return entry;
  }

  // Нормализованная карта label → реальный label (для быстрого lookup).
  // Если несколько old-labels нормализуются в одно — берём первый
  // (стабильный порядок).
  const normalizedOldMap = new Map<string, string>();
  for (const ph of oldPlaceholders) {
    const norm = normalizeLabel(ph.label);
    if (!normalizedOldMap.has(norm)) {
      normalizedOldMap.set(norm, ph.label);
    }
  }

  // ─── Главный проход по новым placeholder'ам ──────────────────────
  // Для каждого нового placeholder'а пытаемся каскад стратегий.
  // Запоминаем для каждого нового label «из какого старого взяли»
  // (нужно чтобы мигрировать служебные ключи).
  type Match = {
    sourceLabel: string;
    strategy: 'exact' | 'normalized' | 'byType';
  } | null;
  const matches: Record<string, Match> = {};

  for (const newPh of newPlaceholders) {
    const newLabel = newPh.label;
    const newType = newPh.type;

    // 1) EXACT
    {
      const entry = takeByLabel(newLabel, newType);
      if (entry) {
        newData[newLabel] = entry.value;
        matches[newLabel] = { sourceLabel: entry.label, strategy: 'exact' };
        if (entry.value !== null) stats.exact++;
        continue;
      }
    }

    // 2) NORMALIZED
    {
      const norm = normalizeLabel(newLabel);
      const oldLabel = normalizedOldMap.get(norm);
      if (oldLabel) {
        const entry = takeByLabel(oldLabel, newType);
        if (entry) {
          newData[newLabel] = entry.value;
          matches[newLabel] = {
            sourceLabel: entry.label,
            strategy: 'normalized',
          };
          if (entry.value !== null) stats.normalized++;
          continue;
        }
      }
    }

    // 3) BY_TYPE
    {
      const entry = oldEntries.find(
        (e) => !used.has(e.label) && e.type === newType,
      );
      if (entry) {
        used.add(entry.label);
        newData[newLabel] = entry.value;
        matches[newLabel] = { sourceLabel: entry.label, strategy: 'byType' };
        if (entry.value !== null) stats.byType++;
        continue;
      }
    }

    // Нет источника — слот остаётся null.
    newData[newLabel] = null;
    matches[newLabel] = null;
  }

  // ─── Считаем lost: непустые значения которые не попали никуда ───
  for (const entry of oldEntries) {
    if (used.has(entry.label)) continue;
    if (entry.value !== null && entry.value !== '') {
      stats.lost++;
      stats.lostLabels.push(entry.label);
    }
  }

  // ─── Миграция content-ключей (__scale__, __offset__, …) ────────
  // Для каждого match мигрируем все content-ключи источника на новый label.
  for (const [newLabel, match] of Object.entries(matches)) {
    if (!match) continue;
    const srcLabel = match.sourceLabel;
    for (const prefix of contentKeyPrefixes) {
      const srcKey = `${prefix}${srcLabel}`;
      if (srcKey in oldData) {
        const v = oldData[srcKey];
        if (v !== null && v !== undefined) {
          newData[`${prefix}${newLabel}`] = v;
        }
      }
    }
  }

  // ─── Балансировочные ключи (__hidden__/__pos__) отбрасываем ──
  // Не копируем их в newData, поскольку они привязаны к рамкам старого
  // мастера. (Здесь явно ничего делать не нужно — мы не копировали их
  // в newData ни на одной из стадий.)
  //
  // Маркер для будущего читателя:
  void BALANCE_KEY_PREFIXES;

  return { newData, stats };
}

/**
 * Нормализует label для нестрогого сопоставления:
 *   - переводит в lowercase
 *   - удаляет все non-alphanumeric (`_`, `-`, пробелы, etc.)
 *
 * Примеры:
 *   normalizeLabel('studentphoto1')   === 'studentphoto1'
 *   normalizeLabel('student_photo_1') === 'studentphoto1'
 *   normalizeLabel('Student Photo 1') === 'studentphoto1'
 *   normalizeLabel('student-photo-1') === 'studentphoto1'
 *
 * Заметим: `studentphoto1` ≠ `studentphoto2` (numeric suffix остаётся
 * частью нормализованного ключа, разные слоты не сольются).
 */
export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Возвращает true если в data есть хотя бы один служебный ключ
 * балансировки для указанного label. Используется в UI чтобы
 * предупредить партнёра о потере балансировки (не реализовано в Р.1,
 * зарезервировано на будущее).
 */
export function hasBalanceOverridesForLabel(
  data: Record<string, string | null>,
  label: string,
): boolean {
  for (const prefix of BALANCE_KEY_PREFIXES) {
    const key = `${prefix}${label}`;
    if (key in data && data[key] !== null && data[key] !== '') {
      return true;
    }
  }
  return false;
}
