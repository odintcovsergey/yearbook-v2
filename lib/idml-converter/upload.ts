/**
 * upload.ts — загрузка ParsedTemplateSet в Supabase.
 *
 * Вставляет одну запись в `template_sets` и пакет записей в `spread_templates`.
 * Не импортирует supabase-клиент сам — принимает его параметром, чтобы
 *   1) функция была тестируема (можно подсунуть mock в unit-тесты),
 *   2) CLI (`scripts/convert-idml.ts`) и будущий API endpoint могли
 *      использовать разные клиенты (admin / authenticated).
 *
 * Контракт идентификации:
 *   - meta.tenantId === null → глобальный шаблон, виден всем тенантам.
 *   - meta.tenantId === <uuid> → шаблон конкретного тенанта.
 *   - is_global вычисляется из meta.tenantId, не передаётся снаружи —
 *     исключаем рассогласование с tenant_id.
 *
 * Уникальность slug:
 *   Partial unique index `idx_template_sets_tenant_slug` на
 *   (coalesce(tenant_id::text, 'global'), slug) where slug is not null.
 *   Перед INSERT делаем явный SELECT по (slug, tenant_id) и решаем что
 *   делать (без force — throw, с force — двухшаговый delete).
 *
 * Откат при сбое batch INSERT в spread_templates:
 *   удаляем только что вставленную запись template_sets;
 *   ON DELETE CASCADE на spread_templates.template_set_id уберёт
 *   частично-вставленные строки автоматически. Откат best-effort:
 *   при ошибке отката логируем и пробрасываем оригинальную ошибку.
 *
 * Формат placeholders / rules в JSON — см. docs/phase-0-spec.md §4.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedTemplateSet } from './types';

const SLUG_REGEX = /^[a-z0-9-]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UploadMeta = {
  name: string;
  slug: string;
  tenantId: string | null;
  printType: 'layflat' | 'soft';
  description?: string | null;
  force?: boolean;
};

export type UploadResult = {
  template_set_id: string;
  spread_count: number;
};

export async function uploadTemplateSetToSupabase(
  parsed: ParsedTemplateSet,
  meta: UploadMeta,
  supabaseAdmin: SupabaseClient,
): Promise<UploadResult> {
  // ─── 1. Валидация meta ───────────────────────────────────────────
  if (!meta.name || meta.name.trim() === '') {
    throw new Error('meta.name must be a non-empty string');
  }
  if (!SLUG_REGEX.test(meta.slug)) {
    throw new Error(`invalid slug "${meta.slug}", expected /^[a-z0-9-]+$/`);
  }
  if (meta.printType !== 'layflat' && meta.printType !== 'soft') {
    throw new Error(`invalid printType "${meta.printType}", expected 'layflat' or 'soft'`);
  }
  if (meta.tenantId !== null && !UUID_REGEX.test(meta.tenantId)) {
    throw new Error(`invalid tenantId "${meta.tenantId}", expected null or UUID`);
  }

  const isGlobal = meta.tenantId === null;
  const force = meta.force ?? false;

  // ─── 2. Pre-validation: дубли master spread names ─────────────────
  // Уникальный индекс idx_spread_templates_set_name (template_set_id, name)
  // упадёт на batch insert, если в IDML два мастера с одинаковым Name.
  // Ловим раньше с понятной ошибкой, не дёргая БД.
  // Идёт ДО SELECT existing — иначе при --force мы бы удалили старое
  // ради импорта, который всё равно упадёт.
  const nameCounts = new Map<string, number>();
  for (const spread of parsed.spread_templates) {
    nameCounts.set(spread.name, (nameCounts.get(spread.name) ?? 0) + 1);
  }
  const duplicates = Array.from(nameCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  if (duplicates.length > 0) {
    throw new Error(
      `IDML contains duplicate master spread names: ${duplicates.join(', ')}. ` +
        `Each master must have unique Name attribute. Fix in InDesign and re-export.`,
    );
  }

  // ─── 3. SELECT existing template_set по (slug, tenant_id) ─────────
  // supabase-js не поддерживает IS NOT DISTINCT FROM напрямую —
  // имитируем через .is(null) / .eq(uuid) развилку.
  let existingQuery = supabaseAdmin
    .from('template_sets')
    .select('id')
    .eq('slug', meta.slug);
  existingQuery =
    meta.tenantId === null
      ? existingQuery.is('tenant_id', null)
      : existingQuery.eq('tenant_id', meta.tenantId);

  const { data: existing, error: selectError } = await existingQuery.maybeSingle<{ id: string }>();
  if (selectError) {
    throw new Error(`Failed to query existing template_set: ${selectError.message}`);
  }

  // ─── 4. existing && !force → throw ────────────────────────────────
  if (existing && !force) {
    const scope = meta.tenantId === null ? 'global' : `tenant ${meta.tenantId}`;
    throw new Error(
      `template_set "${meta.slug}" already exists for ${scope}. Use force:true to overwrite.`,
    );
  }

  // ─── 5. existing && force → двухшаговый delete с логированием ────
  // CASCADE на spread_templates.template_set_id убрал бы spreads сам,
  // но явный delete нужен чтобы залогировать count.
  if (existing && force) {
    const { count: existingSpreadsCount, error: countError } = await supabaseAdmin
      .from('spread_templates')
      .select('id', { count: 'exact', head: true })
      .eq('template_set_id', existing.id);
    if (countError) {
      throw new Error(`Failed to count existing spread_templates: ${countError.message}`);
    }

    const { error: deleteSpreadsError } = await supabaseAdmin
      .from('spread_templates')
      .delete()
      .eq('template_set_id', existing.id);
    if (deleteSpreadsError) {
      throw new Error(
        `Failed to delete existing spread_templates: ${deleteSpreadsError.message}`,
      );
    }
    console.log(
      `[upload] Deleted ${existingSpreadsCount ?? 0} existing spread_templates for force overwrite`,
    );

    const { error: deleteSetError } = await supabaseAdmin
      .from('template_sets')
      .delete()
      .eq('id', existing.id);
    if (deleteSetError) {
      throw new Error(`Failed to delete existing template_set: ${deleteSetError.message}`);
    }
    console.log(`[upload] Deleted existing template_set ${existing.id} for force overwrite`);
  }

  // ─── 6. INSERT template_sets ──────────────────────────────────────
  const { data: insertedSet, error: insertSetError } = await supabaseAdmin
    .from('template_sets')
    .insert({
      name: meta.name,
      slug: meta.slug,
      tenant_id: meta.tenantId,
      print_type: meta.printType,
      page_width_mm: parsed.page_width_mm,
      page_height_mm: parsed.page_height_mm,
      spread_width_mm: parsed.spread_width_mm,
      spread_height_mm: parsed.spread_height_mm,
      bleed_mm: parsed.bleed_mm,
      facing_pages: parsed.facing_pages,
      page_binding: parsed.page_binding,
      is_global: isGlobal,
      description: meta.description ?? null,
      cover_preview_url: null,
    })
    .select('id')
    .single<{ id: string }>();

  if (insertSetError || !insertedSet) {
    throw new Error(
      `Failed to insert template_set: ${insertSetError?.message ?? 'no row returned'}`,
    );
  }
  const templateSetId = insertedSet.id;
  console.log(`[upload] Inserted template_set ${templateSetId}`);

  // ─── 7. Batch INSERT spread_templates ────────────────────────────
  const spreadRows = parsed.spread_templates.map((spread, index) => ({
    template_set_id: templateSetId,
    name: spread.name,
    type: spread.type,
    is_spread: spread.is_spread,
    width_mm: spread.width_mm,
    height_mm: spread.height_mm,
    placeholders: spread.placeholders,
    rules: spread.rules ?? null,
    sort_order: index,
    background_url: null,
  }));

  const { error: insertSpreadsError } = await supabaseAdmin
    .from('spread_templates')
    .insert(spreadRows);

  // ─── 8. Best-effort откат при сбое batch insert ──────────────────
  if (insertSpreadsError) {
    console.error(
      `[upload] Failed to insert spread_templates: ${insertSpreadsError.message}. ` +
        `Rolling back template_set ${templateSetId}…`,
    );
    const { error: rollbackError } = await supabaseAdmin
      .from('template_sets')
      .delete()
      .eq('id', templateSetId);
    if (rollbackError) {
      console.error(
        `[upload] Rollback failed: could not delete template_set ${templateSetId}: ` +
          `${rollbackError.message}. Manual cleanup required.`,
      );
    } else {
      console.log(
        `[upload] Rolled back template_set ${templateSetId} ` +
          `(CASCADE removed any partial spread_templates)`,
      );
    }
    throw new Error(`Failed to insert spread_templates: ${insertSpreadsError.message}`);
  }
  console.log(`[upload] Inserted ${spreadRows.length} spread_templates`);

  // ─── 9. Return ───────────────────────────────────────────────────
  return {
    template_set_id: templateSetId,
    spread_count: parsed.spread_templates.length,
  };
}
