/**
 * Адаптер AlbumLayout (rule engine) → BuildResult (legacy) (РЭ.16.2 + РЭ.17.1).
 *
 * Зачем:
 *   Существующий handleBuildAlbum пишет результат в album_layouts.spreads
 *   как массив SpreadInstance. Редактор фазы Л/М, экспорт в PDF, превью —
 *   все работают через этот формат. Чтобы подключить rule engine без
 *   переделки редактора, маппим AlbumLayout (left/right.bindings +
 *   decision_trace) обратно в BuildResult.
 *
 * РЭ.17.1 — КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ:
 *   До РЭ.17.1 адаптер делал 1:1 маппинг (один rule engine spread →
 *   один legacy SpreadInstance). Это БЫЛО НЕВЕРНО. Проверка на боевом
 *   альбоме 'тест 2026' показала:
 *     - rule engine выдал spread{left: F-Head-SmallGrid, right: G-HalfClass}
 *     - адаптер создал 1 SpreadInstance с template_id=F-Head, data из
 *       обеих сторон
 *     - редактор/превью группирует SpreadInstance ПОПАРНО (по соседним
 *       индексам) в визуальные развороты. F-Head попал в один разворот
 *       со следующим SpreadInstance (первый ученик), G-HalfClass пропала.
 *
 *   В legacy формате СЕМАНТИКА:
 *     - 1 SpreadInstance = 1 СТРАНИЦА (левая или правая сторона)
 *     - spread_index — глобальный индекс СТРАНИЦЫ (0, 1, 2, …)
 *     - Редактор/превью группирует пары (0+1, 2+3, …) в развороты
 *     - Исключение: `is_spread=true` мастер занимает оба листа →
 *       1 SpreadInstance на весь разворот
 *
 *   Это легко проверить в legacy buildAlbum: buildTeacherSectionTwoPage
 *   делает 2 push'а (F-Head + G-Class отдельно), buildStudentSection
 *   Universal-path-a делает по 2 push'а на пару (E-Student-Left +
 *   E-Student-Right отдельно).
 *
 * Маппинг после фикса:
 *   spread.is_spread=true (двухстраничный мастер занимает оба листа) →
 *     1 SpreadInstance с template_id=LEFT (или RIGHT — оба указывают
 *     на один мастер)
 *
 *   spread.is_spread=false (или undefined):
 *     - left присутствует → 1 SpreadInstance из left
 *     - right присутствует → 1 SpreadInstance из right (с увеличенным
 *       глобальным индексом)
 *
 * Маппинг bindings:
 *   __master_name__       → отбрасывается
 *   __hidden__X, __pos__X → переносятся как есть
 *   null/undefined        → null
 *   string                → как есть
 *   number/boolean        → String(v)
 *   object/array          → JSON.stringify (fallback)
 *
 * Warnings:
 *   - rule engine warnings → конвертируются в BuildWarning
 *   - status='partial' → дополнительный warning rule_engine_partial
 *   - status='failed' → throw (caller сделает fallback на legacy)
 *
 *   Warning 'mixed_pages_not_supported_by_editor' из РЭ.16.2 УБРАН —
 *   при корректной 1:N сегментации mixed_pages это нормальное явление
 *   (две страницы с разными мастерами — каждая в своём SpreadInstance,
 *   редактор отлично рендерит).
 */

import type {
  AlbumLayout,
  SpreadInstance as RulesSpreadInstance,
  PageInstance,
} from './types';
import type {
  BuildResult,
  SpreadInstance as LegacySpreadInstance,
  BuildWarning,
} from '@/lib/album-builder/types';

/** Результат адаптации с дополнительными rules-метаданными для caller'а. */
export type AdaptedResult = {
  result: BuildResult;
  rules_meta: {
    status: AlbumLayout['status'];
    rules_version: string;
    decision_trace: AlbumLayout['decision_trace'];
    total_spreads: number;
    /** Индексы разворотов rule engine с mixed_pages (для audit_log). */
    mixed_pages_indices: number[];
  };
};

export function adaptAlbumLayoutToBuildResult(layout: AlbumLayout): AdaptedResult {
  if (layout.status === 'failed') {
    throw new Error(
      `rule engine failed: ${layout.warnings.join('; ') || 'no warnings provided'}`,
    );
  }

  const warnings: BuildWarning[] = [];
  const legacySpreads: LegacySpreadInstance[] = [];
  const mixedIndices: number[] = [];
  let pageCounter = 0; // глобальный индекс страницы в legacy формате

  for (const sp of layout.spreads) {
    if (sp.mixed_pages) mixedIndices.push(sp.spread_index);

    // Если ни одной страницы — это ошибка алгоритма, такого быть не должно.
    if (!sp.left && !sp.right) {
      warnings.push({
        code: 'rule_engine_warning' as never,
        detail: `spread[${sp.spread_index}] without pages — skipped`,
      });
      continue;
    }

    // is_spread: один двухстраничный мастер занимает оба листа (например J-Spread).
    // В rule engine left=right=один и тот же мастер. В legacy → 1 SpreadInstance.
    if (sp.is_spread) {
      const page = sp.left ?? (sp.right as PageInstance);
      const legacy = pageToLegacy(page, pageCounter++, sp.spread_index, warnings);
      if (legacy) legacySpreads.push(legacy);
      continue;
    }

    // Обычный случай: каждая сторона — отдельный legacy SpreadInstance.
    if (sp.left) {
      const legacy = pageToLegacy(sp.left, pageCounter++, sp.spread_index, warnings);
      if (legacy) legacySpreads.push(legacy);
    }
    if (sp.right) {
      const legacy = pageToLegacy(sp.right, pageCounter++, sp.spread_index, warnings);
      if (legacy) legacySpreads.push(legacy);
    }
  }

  // Конвертируем warnings rule engine в BuildWarning.
  //
  // РЭ.36.UI: engine отдаёт warnings как строки формата
  // `<code>: <detail>` (например: `common_required_page_skipped: 'J-Collage-4' (...)`).
  // Раньше всё попадало в общий код 'rule_engine_warning' — UI не мог
  // их различать. Теперь извлекаем реальный код через regex; если паттерн
  // не совпал (свободная строка типа 'something happened') — fallback
  // на 'rule_engine_warning' как раньше.
  const CODE_PREFIX_RE = /^([a-z][a-z0-9_]*):\s*/;
  for (const w of layout.warnings) {
    const match = w.match(CODE_PREFIX_RE);
    if (match) {
      warnings.push({
        code: match[1] as never,
        detail: w.slice(match[0].length),
      });
    } else {
      warnings.push({
        code: 'rule_engine_warning' as never,
        detail: w,
      });
    }
  }

  if (layout.status === 'partial') {
    warnings.push({
      code: 'rule_engine_partial' as never,
      detail: `rule engine отметил status='partial' — см. остальные warnings`,
    });
  }

  return {
    result: { spreads: legacySpreads, warnings },
    rules_meta: {
      status: layout.status,
      rules_version: layout.rules_version,
      decision_trace: layout.decision_trace,
      total_spreads: layout.spreads.length,
      mixed_pages_indices: mixedIndices,
    },
  };
}

/**
 * Конвертирует один PageInstance в legacy SpreadInstance.
 * Возвращает null если master не найден (с warning).
 */
function pageToLegacy(
  page: PageInstance,
  legacyIndex: number,
  ruleSpreadIndex: number,
  warnings: BuildWarning[],
): LegacySpreadInstance | null {
  const masterName = extractMasterName(page);

  // pageToInstance() в build.ts ставит master_id='__missing__/<name>'
  // когда мастер не найден в template_set.
  if (page.master_id.startsWith('__missing__/')) {
    warnings.push({
      code: 'master_not_found' as never,
      detail: `rule_spread[${ruleSpreadIndex}] master '${masterName}' not in template_set — skipped`,
    });
    return null;
  }

  return {
    spread_index: legacyIndex,
    template_id: page.master_id,
    template_name: masterName,
    data: normalizeBindings(page.bindings),
    // РЭ.35.Ж.4: пробрасываем флаг начала нового разворота из rule engine
    // в legacy формат. UI segmentToSpreads читает его чтобы корректно
    // сгруппировать страницы (закрыть предыдущий разворот висящим если
    // эта страница помечена как начало секции).
    ...(page.section_start ? { section_start: true } : {}),
  };
}

function extractMasterName(p: PageInstance): string {
  const n = p.bindings['__master_name__'];
  if (typeof n === 'string') return n;
  if (p.master_id.startsWith('__missing__/')) {
    return p.master_id.replace('__missing__/', '');
  }
  return p.master_id;
}

/**
 * Конвертирует bindings из rule engine (Record<string, unknown>) в формат
 * legacy data (Record<string, string | null>).
 */
function normalizeBindings(
  bindings: Record<string, unknown>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(bindings)) {
    if (k === '__master_name__') continue;
    if (v === null || v === undefined) {
      out[k] = null;
      continue;
    }
    if (typeof v === 'string') {
      out[k] = v;
      continue;
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = String(v);
      continue;
    }
    out[k] = JSON.stringify(v);
  }
  return out;
}
