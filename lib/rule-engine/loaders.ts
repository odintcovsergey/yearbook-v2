/**
 * Rule Engine — загрузка данных из Supabase.
 *
 * Спецификация: docs/rule-engine-spec.md v1.3 §6 (модель данных).
 *
 * Используется живым движком buildFromSectionStructure: грузит preset
 * (комплектация) + masters (spread_templates дизайна, byName).
 *
 * Поля bundle.rules / bundle.families сохранены в типе RuleEngineBundle ради
 * совместимости (их конструируют тест-фикстуры), но БОЛЬШЕ НЕ загружаются из БД
 * и НЕ читаются живым движком — это наследие удалённого buildFromRules
 * (РЭ.21.8.чистка-1, 20.05.2026). SELECT'ы rules/template_families убраны как
 * мёртвая работа на проде; поля заполняются пустыми массивами. Полная типовая
 * чистка (удаление полей/типов + 25 тест-фикстур) — отдельной задачей после РЭ.22.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Preset, Rule, TemplateFamily, TransitionScenario } from './types';
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
 * РЭ.21.6.2: template_set по умолчанию берётся ИЗ ПРЕСЕТА (preset.template_set_id);
 * если в пресете NULL → фолбэк на глобальный 'okeybook-default'.
 *
 * Развязка шаблон↔дизайн (17.06.2026): необязательный `templateSetIdOverride`
 * — это ДИЗАЙН, выбранный в заказе (albums.template_set_id). Когда он задан,
 * он ПЕРЕБИВАЕТ дизайн-подсказку пресета: одна структура (preset) собирается
 * на любом дизайне. Боевая сборка альбома всегда передаёт его (дизайн заказа —
 * источник правды). Превью шаблонов в каталоге override не передают — там
 * структура показывается на своём дизайне-подсказке.
 */
export async function loadBundle(
  supabase: SupabaseClient,
  presetId: string,
  tenantId: string | null,
  templateSetIdOverride?: string | null,
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

  // 2) families / rules — НЕ грузим из БД: живой движок buildFromSectionStructure
  // их не читает (наследие удалённого buildFromRules, РЭ.21.8.чистка-1). Пустые
  // массивы — для совместимости типа RuleEngineBundle (его конструируют тесты).
  // SELECT'ы template_families/rules убраны как мёртвая работа на проде.
  // (tenantId оставлен в сигнатуре для callers; больше нигде не используется.)
  const families: TemplateFamily[] = [];
  const rules: Rule[] = [];

  // 3) Template set: slug из пресета, либо фолбэк на 'okeybook-default'.
  // РЭ.21.6.2: один дополнительный SELECT для разрешения uuid → slug.
  // Стоимость незначительна (1 строка по PK), зато slug остаётся
  // человеко-читаемым identifier-ом в loadTemplateSet.
  // Развязка: дизайн заказа (override) приоритетнее дизайн-подсказки пресета.
  let templateSetSlug = 'okeybook-default';
  const effectiveTemplateSetId = templateSetIdOverride ?? preset.template_set_id;
  if (effectiveTemplateSetId) {
    const { data: tsRow, error: tsErr } = await supabase
      .from('template_sets')
      .select('slug')
      .eq('id', effectiveTemplateSetId)
      .single();
    if (tsErr || !tsRow?.slug) {
      // Не падаем — fallback на okeybook-default. Это может произойти если
      // template_set был удалён (ON DELETE SET NULL не сработал из-за
      // отложенного коммита) или если slug у него NULL (фаза 0 артефакт).
      // Логируем для диагностики.
      console.warn(
        `[loadBundle] preset '${presetId}' / override template_set_id=` +
        `${effectiveTemplateSetId} but slug not resolved (${tsErr?.message ?? 'no slug'}); ` +
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
    // РЭ.37.1: симметризация хвоста students-секции. БД-default = false.
    // Если по какой-то причине столбца ещё нет в строке (например,
    // тестовый стенд до миграции) — безопасный фолбэк на false.
    symmetrize_students_tail:
      typeof row.symmetrize_students_tail === 'boolean'
        ? row.symmetrize_students_tail
        : false,
    // РЭ.37.6: ручной сценарий transition-разворота. БД хранит как
    // JSONB или NULL. Парсим safely — если приходит мусор (не object,
    // или mode не строка) — возвращаем null (engine упадёт на default).
    transition_scenario: parseTransitionScenario(row.transition_scenario),
  };
}

/**
 * РЭ.37.6: парсер transition_scenario из БД-строки.
 *
 * Принимает что угодно (raw JSONB значение) и возвращает либо валидный
 * TransitionScenario, либо null. Безопасен к мусору — некорректные
 * структуры → null (engine применит default-логику).
 *
 * NB: API уже валидирует структуру на запись (см. rule_preset_update в
 * app/api/tenant/route.ts) + БД CHECK constraint. Здесь — последняя
 * линия защиты на случай если что-то пошло не так.
 */
function parseTransitionScenario(raw: unknown): TransitionScenario | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const mode = obj.mode;
  if (mode === 'default') return { mode: 'default' };
  if (mode !== 'custom') return null;
  // custom: master_id поля должны быть string|null|undefined.
  // undefined нормализуем к null.
  const tail_left = obj.tail_left_master_id;
  const tail_right = obj.tail_right_master_id;
  const closing = obj.closing_master_id;
  const validIdOrNull = (v: unknown): v is string | null =>
    v === null || v === undefined || typeof v === 'string';
  if (!validIdOrNull(tail_left) || !validIdOrNull(tail_right) || !validIdOrNull(closing)) {
    return null;
  }
  return {
    mode: 'custom',
    tail_left_master_id: typeof tail_left === 'string' ? tail_left : null,
    tail_right_master_id: typeof tail_right === 'string' ? tail_right : null,
    closing_master_id: typeof closing === 'string' ? closing : null,
  };
}

// familyRowToFamily / ruleRowToRule удалены (РЭ.21.8.чистка-N, Этап А): мапперы
// нужны были только для загрузки families/rules в bundle, которую живой движок
// не читал. Типы Rule/TemplateFamily пока сохранены (используются тест-фикстурами).
