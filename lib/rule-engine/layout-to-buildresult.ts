/**
 * Адаптер AlbumLayout (rule engine) → BuildResult (legacy) (РЭ.16.2).
 *
 * Зачем:
 *   Существующий handleBuildAlbum пишет результат в album_layouts.spreads
 *   как массив SpreadInstance (template_id + data: Record<string,string>).
 *   Редактор фазы Л/М, экспорт в PDF, превью — все работают через этот
 *   формат. Чтобы подключить rule engine без переделки редактора, мы
 *   маппим AlbumLayout (left/right.bindings + decision_trace) обратно в
 *   BuildResult.
 *
 * Маппинг разворотов:
 *   left + right с ОДНИМ master_id (двухстраничный мастер) →
 *     1 SpreadInstance с этим master_id, объединённые bindings
 *     (если ключи пересекаются — победа right; они и так разнесены
 *     по сторонам конвенцией left_/right_ при пересечении).
 *
 *   только left ИЛИ только right (одиночная страница) →
 *     1 SpreadInstance с master_id страницы, bindings из неё.
 *
 *   left.master_id ≠ right.master_id (mixed_pages, например
 *   E-Standard-Left + J-Half) → 1 SpreadInstance с master_id ЛЕВОГО
 *   (он первый по странице), bindings объединённые с правого тоже.
 *   Plus warning `mixed_pages_not_supported_by_editor` чтобы партнёр
 *   видел: «редактор покажет только левую сторону, правая мастер X
 *   проигнорирован». Это редкий случай (на боевых превью 16.05 не
 *   попадался), но юридически возможен в rule engine.
 *
 * Маппинг bindings:
 *   - __master_name__ → отбрасывается (служебный ключ rule engine для UI)
 *   - __hidden__X → переносится как есть (редактор/экспорт их игнорируют,
 *     но они нужны для PDF-рендера в финальной фазе)
 *   - __pos__X → переносится как есть (то же)
 *   - prefab string значения → как есть
 *   - null/undefined → null (legacy ожидает string | null)
 *   - unknown типы (number, boolean) → String(v) или null
 *
 * Warnings rule engine конвертируются в BuildWarning с кодом
 * 'rule_engine_warning' (новый код).
 *
 * Status:
 *   'ok'      → нет дополнительного warning
 *   'partial' → warning rule_engine_partial: «движок отметил проблемы,
 *               см. остальные warnings»
 *   'failed'  → throw — caller сам ловит и делает fallback на legacy
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
  /** Метаданные rule engine, могут пригодиться для записи в album_layouts.rules_meta */
  rules_meta: {
    status: AlbumLayout['status'];
    rules_version: string;
    decision_trace: AlbumLayout['decision_trace'];
    total_spreads: number;
    /** Развороты с mixed_pages — для каких партнёр должен знать что редактор покажет только левую */
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
  const spreads: LegacySpreadInstance[] = [];
  const mixedIndices: number[] = [];

  for (const sp of layout.spreads) {
    const adapted = adaptSpread(sp, warnings);
    if (adapted) {
      spreads.push(adapted);
      if (sp.mixed_pages) mixedIndices.push(sp.spread_index);
    }
  }

  // Конвертируем warnings rule engine в BuildWarning.
  for (const w of layout.warnings) {
    warnings.push({
      code: 'rule_engine_warning' as never, // расширенный код, см. ниже
      detail: w,
    });
  }

  if (layout.status === 'partial') {
    warnings.push({
      code: 'rule_engine_partial' as never,
      detail: `rule engine отметил status='partial' — см. остальные warnings`,
    });
  }

  return {
    result: { spreads, warnings },
    rules_meta: {
      status: layout.status,
      rules_version: layout.rules_version,
      decision_trace: layout.decision_trace,
      total_spreads: layout.spreads.length,
      mixed_pages_indices: mixedIndices,
    },
  };
}

function adaptSpread(
  sp: RulesSpreadInstance,
  warnings: BuildWarning[],
): LegacySpreadInstance | null {
  const { spread_index, left, right, mixed_pages } = sp;

  // Если ни одной страницы — это ошибка алгоритма, такого быть не должно.
  if (!left && !right) {
    warnings.push({
      code: 'rule_engine_warning' as never,
      detail: `spread[${spread_index}] without pages — skipped`,
    });
    return null;
  }

  // Определяем основной мастер для template_id.
  // mixed_pages: берём LEFT (он первый по чтению).
  // Иначе любой непустой.
  const primary: PageInstance =
    mixed_pages && left ? left : left ?? (right as PageInstance);

  const primaryMasterName = extractMasterName(primary);

  // pageToInstance() в build.ts ставит master_id='__missing__/<name>'
  // когда мастер не найден в template_set. Это сигнал → не создаём
  // SpreadInstance в legacy формате (редактор не найдёт template_id).
  if (primary.master_id.startsWith('__missing__/')) {
    warnings.push({
      code: 'master_not_found' as never,
      detail: `spread[${spread_index}] master '${primaryMasterName}' not in template_set — skipped`,
    });
    return null;
  }

  // Объединяем bindings обеих сторон. Для mixed_pages правые bindings
  // тоже попадают (редактор их не увидит без правого мастера, но в data
  // они сохранятся для рендера).
  const data: Record<string, string | null> = {};
  if (left) Object.assign(data, normalizeBindings(left.bindings));
  if (right) Object.assign(data, normalizeBindings(right.bindings));

  if (mixed_pages && left && right && left.master_id !== right.master_id) {
    const rightName = extractMasterName(right);
    warnings.push({
      code: 'mixed_pages_not_supported_by_editor' as never,
      detail: `spread[${spread_index}]: разные мастера слева (${primaryMasterName}) и справа (${rightName}) — редактор покажет только левую сторону`,
    });
  }

  return {
    spread_index,
    template_id: primary.master_id,
    template_name: primaryMasterName,
    data,
  };
}

function extractMasterName(p: PageInstance): string {
  const n = p.bindings['__master_name__'];
  if (typeof n === 'string') return n;
  // Fallback: вытаскиваем из __missing__/<name> если есть
  if (p.master_id.startsWith('__missing__/')) {
    return p.master_id.replace('__missing__/', '');
  }
  return p.master_id;
}

/**
 * Конвертирует bindings из rule engine (Record<string, unknown>) в формат
 * legacy data (Record<string, string | null>).
 *
 * - __master_name__ выбрасывается (служебный ключ rule engine для UI)
 * - __hidden__X, __pos__X — переносятся (нужны для PDF-рендера balance.ts)
 * - null → null
 * - string → string
 * - number/boolean → String(v)
 * - object/array → JSON.stringify (на всякий случай, но обычно нет)
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
