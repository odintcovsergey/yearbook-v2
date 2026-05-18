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
 * @param templateSetSlug — slug template_set'а (по умолчанию 'okeybook-default')
 */
export async function loadBundle(
  supabase: SupabaseClient,
  presetId: string,
  tenantId: string | null,
  templateSetSlug = 'okeybook-default',
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

  // 4) Template set + masters
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
    // РЭ.20: новые поля. БД-колонка NOT NULL DEFAULT 24 → fallback 24.
    total_pages: Number(row.total_pages ?? 24),
    // РЭ.21.5: диапазон страниц. nullable до явного заполнения партнёром.
    // Числовое приведение пишем через тернарник чтобы 0 не превращался
    // в null случайно (хотя 0 страниц это нонсенс, но строгая семантика
    // лучше чем неявная).
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
