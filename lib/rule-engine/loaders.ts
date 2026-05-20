/**
 * Rule Engine — загрузка данных из Supabase.
 *
 * Спецификация: docs/rule-engine-spec.md v1.3 §6 (модель данных).
 *
 * Используется build.ts чтобы получить полный набор:
 *   - preset (комплектация)
 *   - rules (упорядоченные по priority desc для семейств преста)
 *   - families (template_families — для валидации section.density и пр.)
 *   - masters (spread_templates конкретного template_set, byName)
 *
 * Стратегия: всё грузим заранее, в build.ts передаём как готовые структуры.
 * Так buildFromRules остаётся чистой синхронной функцией.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Preset, Rule, TemplateFamily } from './types';
import { loadTemplateSet } from '@/lib/album-builder/load-template-set';
import type { TemplateSet, SpreadTemplate } from '@/lib/album-builder/types';

export interface RuleEngineBundle {
  preset: Preset;
  /** Все правила всех семейств, упорядочены по priority desc. */
  rules: Rule[];
  families: TemplateFamily[];
  templateSet: TemplateSet;
  /** Карта name → SpreadTemplate для быстрого master lookup. */
  mastersByName: Map<string, SpreadTemplate>;
}

/**
 * Загружает все необходимые сущности для одной сборки альбома.
 *
 * @param supabase — клиент с правами SELECT на presets, rules, template_families, spread_templates
 * @param presetId — id пресета (из таблицы `presets`, не `config_presets`)
 * @param tenantId — id арендатора (для tenant-aware rules) или null для только-глобальных
 *
 * РЭ.21.6.2: template_set теперь берётся ИЗ ПРЕСЕТА (preset.template_set_id).
 * Если в пресете NULL → фолбэк на глобальный 'okeybook-default'. 4-й
 * аргумент templateSetSlug удалён намеренно: иначе template_set_id из
 * пресета молча игнорировался бы.
 */
export async function loadBundle(
  supabase: SupabaseClient,
  presetId: string,
  tenantId: string | null,
): Promise<RuleEngineBundle> {
  // 1) Preset
  const { data: presetRow, error: presetErr } = await supabase
    .from('presets')
    .select('*')
    .eq('id', presetId)
    .single();
  if (presetErr || !presetRow) {
    throw new Error(`preset '${presetId}' not found: ${presetErr?.message ?? 'no row'}`);
  }
  const preset: Preset = presetRowToPreset(presetRow);

  // 2) Families (все включённые)
  const { data: familyRows, error: famErr } = await supabase
    .from('template_families')
    .select('*');
  if (famErr || !familyRows) {
    throw new Error(`template_families load failed: ${famErr?.message ?? 'empty'}`);
  }
  const families: TemplateFamily[] = familyRows.map(familyRowToFamily);

  // 3) Rules — все enabled, упорядочены по priority desc.
  // Глобальные (tenant_id IS NULL) + конкретного тенанта если задан.
  let rulesQuery = supabase
    .from('rules')
    .select('*')
    .eq('enabled', true)
    .order('priority', { ascending: false });
  if (tenantId !== null) {
    rulesQuery = rulesQuery.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  } else {
    rulesQuery = rulesQuery.is('tenant_id', null);
  }
  const { data: ruleRows, error: ruleErr } = await rulesQuery;
  if (ruleErr || !ruleRows) {
    throw new Error(`rules load failed: ${ruleErr?.message ?? 'empty'}`);
  }
  const rules: Rule[] = ruleRows.map(ruleRowToRule);

  // 4) Template set: slug из пресета, либо фолбэк на 'okeybook-default'.
  // РЭ.21.6.2: один дополнительный SELECT для разрешения uuid → slug.
  // Стоимость незначительна (1 строка по PK), зато slug остаётся
  // человеко-читаемым identifier-ом в loadTemplateSet.
  let templateSetSlug = 'okeybook-default';
  if (preset.template_set_id) {
    const { data: tsRow, error: tsErr } = await supabase
      .from('template_sets')
      .select('slug')
      .eq('id', preset.template_set_id)
      .single();
    if (tsErr || !tsRow?.slug) {
      // Не падаем — fallback на okeybook-default. Это может произойти если
      // template_set был удалён (ON DELETE SET NULL не сработал из-за
      // отложенного коммита) или если slug у него NULL (фаза 0 артефакт).
      // Логируем для диагностики.
      console.warn(
        `[loadBundle] preset '${presetId}' references template_set_id=` +
        `${preset.template_set_id} but slug not resolved (${tsErr?.message ?? 'no slug'}); ` +
        `falling back to 'okeybook-default'`
      );
    } else {
      templateSetSlug = String(tsRow.slug);
    }
  }

  const templateSet = await loadTemplateSet(supabase, templateSetSlug);
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of templateSet.spreads) {
    mastersByName.set(m.name, m);
  }

  return { preset, rules, families, templateSet, mastersByName };
}

// =============================================================================
// Row → domain mappers
// =============================================================================

function presetRowToPreset(row: Record<string, unknown>): Preset {
  return {
    id: String(row.id),
    display_name: String(row.display_name ?? row.id),
    print_type: row.print_type as Preset['print_type'],
    pages_per_spread: Number(row.pages_per_spread ?? 2),
    version: String(row.version ?? '1.0'),
    sections: (row.sections as Preset['sections']) ?? [],
    parent_preset_id:
      row.parent_preset_id === null || row.parent_preset_id === undefined
        ? undefined
        : String(row.parent_preset_id),
    tenant_id: row.tenant_id === null || row.tenant_id === undefined ? null : String(row.tenant_id),
    enabled: row.enabled === false ? false : true,
    // РЭ.21.6: ссылка на template_set. null = фолбэк на okeybook-default
    // в loadBundle.
    template_set_id:
      row.template_set_id === null || row.template_set_id === undefined
        ? null
        : String(row.template_set_id),
    // РЭ.21.5.3: диапазон страниц. total_pages удалена из БД.
    min_pages:
      row.min_pages === null || row.min_pages === undefined
        ? null
        : Number(row.min_pages),
    max_pages:
      row.max_pages === null || row.max_pages === undefined
        ? null
        : Number(row.max_pages),
    density:
      row.density === null || row.density === undefined
        ? null
        : (row.density as Preset['density']),
    sheet_type:
      row.sheet_type === null || row.sheet_type === undefined
        ? null
        : (row.sheet_type as Preset['sheet_type']),
    // РЭ.21.8: section_structure (jsonb). Серверный валидатор гарантирует
    // корректную форму при write через API. Здесь — минимальная защита от
    // случаев, когда поле NULL (старые записи) или некорректно положено
    // через прямой SQL: принимаем только массив, иначе → null. Подробная
    // структура (тип секций, слоты) валидируется build engine'ом
    // (buildFromSectionStructure, РЭ.21.8.3+) — точка падения там будет
    // ближе к смыслу.
    section_structure: Array.isArray(row.section_structure)
      ? (row.section_structure as Preset['section_structure'])
      : null,
    // РЭ.21.8.15 (DEPRECATED legacy student-fields).
    //
    // ⚠️ ИЗНАЧАЛЬНО эти поля НЕ были добавлены в presetRowToPreset (РЭ.21.8.15
    // 19.05.2026) — из-за чего `buildOnePerSpreadAdaptive` фактически
    // никогда не активировался в проде: engine читал `preset.student_*`,
    // получал `undefined`, useSemanticSearch=false → fallback на
    // `E-Max-Left/Right`. Тесты не падали потому что собирали Preset
    // напрямую. Закрыто попутно в РЭ.22.2 одновременно с добавлением
    // новых полей двух-осевой модели (см. ниже).
    student_pages_per_student:
      row.student_pages_per_student === null || row.student_pages_per_student === undefined
        ? null
        : (Number(row.student_pages_per_student) === 2 ? 2 : 1),
    student_friend_photos:
      row.student_friend_photos === null || row.student_friend_photos === undefined
        ? null
        : Number(row.student_friend_photos),
    student_has_quote:
      typeof row.student_has_quote === 'boolean' ? row.student_has_quote : null,
    // РЭ.22.2: двух-осевая модель (см. docs/phase-Р22-spec.md §3).
    // Engine начнёт читать эти поля в РЭ.22.4-6 (priority over legacy
    // student_pages_per_student).
    student_layout_mode:
      row.student_layout_mode === 'page' ||
      row.student_layout_mode === 'spread' ||
      row.student_layout_mode === 'grid'
        ? row.student_layout_mode
        : null,
    student_grid_size:
      row.student_grid_size === null || row.student_grid_size === undefined
        ? null
        : Number(row.student_grid_size),
  };
}

function familyRowToFamily(row: Record<string, unknown>): TemplateFamily {
  return {
    id: String(row.id),
    display_name: String(row.display_name ?? row.id),
    aliases: (row.aliases as string[]) ?? [],
    deprecated: !!row.deprecated,
    version: String(row.version ?? '1.0'),
    tenant_id:
      row.tenant_id === null || row.tenant_id === undefined ? null : String(row.tenant_id),
    params: (row.params as TemplateFamily['params']) ?? {},
    density_config: (row.density_config as TemplateFamily['density_config']) ?? null,
  };
}

function ruleRowToRule(row: Record<string, unknown>): Rule {
  // rule_json содержит весь объект правила; плоские колонки — для индексации/фильтрации.
  // Берём из rule_json, fallback на плоские поля если что-то отсутствует.
  const json = (row.rule_json as Record<string, unknown>) || {};
  return {
    id: String(row.id ?? json.id),
    family_id: String(row.family_id ?? json.family_id),
    family_version: String(row.family_version ?? json.family_version ?? '1.0'),
    priority: Number(row.priority ?? json.priority ?? 0),
    when: (json.when as Rule['when']) ?? {},
    produces: json.produces as Rule['produces'],
    bind: (json.bind as Rule['bind']) ?? undefined,
    consumes: (json.consumes as Rule['consumes']) ?? undefined,
    balance: (json.balance as Rule['balance']) ?? undefined,
    variants: (json.variants as Rule['variants']) ?? undefined,
    display_name: json.display_name as string | undefined,
    description: json.description as string | undefined,
    enabled: row.enabled === false ? false : true,
  };
}
