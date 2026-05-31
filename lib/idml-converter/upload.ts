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
import { getFamilyMapping } from './family-mapping';
import type { DecorationPlaceholder, ParsedTemplateSet } from './types';

/** Bucket для embedded-картинок привязанного декора (миграция 2026-05-31). */
const DECORATIONS_BUCKET = 'template-decorations';

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

  // ─── 5. existing && force → UPDATE template_set + DELETE+INSERT spreads ──
  // Старая логика delete+insert падала с FK violation, если на template_set
  // ссылались album_layouts. Новый подход (РЭ.3.5):
  //   - переиспользуем существующий template_sets.id
  //   - UPDATE его полей (name, print_type, размеры, …)
  //   - DELETE+INSERT всех spread_templates (старые мы уже бэкапить не пытаемся)
  // Так album_layouts.template_set_id остаётся валидным.
  //
  // ВНИМАНИЕ: если у тенанта были альбомы со старыми spread_templates_id —
  // в album_layouts.spreads они могли ссылаться на конкретные spread_template_id,
  // которые сейчас исчезнут. Это не break compatibility прямо сейчас (FK
  // только на template_set_id, не на spread_template_id), но при попытке
  // ре-рендерить старый альбом он не найдёт нужный мастер по id.
  // В rule engine MVP это не критично — старые альбомы либо пересобираются,
  // либо помечаются needs_rebuild.
  let reusedTemplateSetId: string | null = null;
  if (existing && force) {
    // Подсчёт + DELETE существующих spread_templates
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

    // UPDATE template_sets (вместо DELETE — чтобы не сломать FK из album_layouts)
    const { error: updateSetError } = await supabaseAdmin
      .from('template_sets')
      .update({
        name: meta.name,
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (updateSetError) {
      throw new Error(`Failed to update existing template_set: ${updateSetError.message}`);
    }
    console.log(`[upload] Updated existing template_set ${existing.id} for force overwrite`);
    reusedTemplateSetId = existing.id;
  }

  // ─── 6. INSERT template_sets (только если не reuse) ──────────────────
  let templateSetId: string;
  if (reusedTemplateSetId !== null) {
    templateSetId = reusedTemplateSetId;
  } else {
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
    templateSetId = insertedSet.id;
    console.log(`[upload] Inserted template_set ${templateSetId}`);
  }

  // ─── 6.5. Загрузка embedded-картинок декора в storage ────────────
  // Этап 2б ТЗ привязанного декора. Декор-плейсхолдеры пришли из парсера с
  // транзитным полем `_embedded` (base64 картинки). Декодируем, грузим в
  // bucket template-decorations, проставляем `url`, удаляем `_embedded` —
  // ИНАЧЕ base64 (сотни КБ на декор) попадёт в jsonb-колонку placeholders.
  // Мутируем parsed.spread_templates[].placeholders на месте; spreadRows ниже
  // сериализует уже очищенные плейсхолдеры. Идёт ПОСЛЕ резолва templateSetId
  // (нужен для пути файла) и ДО формирования spreadRows.
  await uploadDecorationImages(parsed, templateSetId, supabaseAdmin);

  // ─── 7. Batch INSERT spread_templates ────────────────────────────
  // Поля family_id / page_type / density / params проставляются
  // через family-mapping.ts (РЭ.3.5). Если имя мастера неизвестно —
  // эти поля остаются NULL/{}, мастер всё равно загрузится, но не
  // попадёт в правила rule engine пока админ не проставит вручную.
  const unmappedMasters: string[] = [];
  const spreadRows = parsed.spread_templates.map((spread, index) => {
    const mapping = getFamilyMapping(spread.name);
    if (!mapping) {
      unmappedMasters.push(spread.name);
    }
    return {
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
      // ─── Rule engine метаданные (могут быть null если mapping отсутствует) ──
      family_id: mapping?.family_id ?? null,
      page_type: mapping?.page_type ?? 'page-any',
      density: mapping?.density ?? null,
      params: mapping?.params ?? {},
      // ─── РЭ.58: legacy-поля движков (page_role, slot_capacity, applies_to_configs) ──
      // По ним ищут мастера движки students.ts / common.ts / teachers.ts через
      // findStudentMaster / findStudentGridMaster / etc. Если null/[] — мастер не
      // найдётся семантическим поиском, секции не соберутся (баг РЭ.58).
      page_role: mapping?.page_role ?? null,
      slot_capacity: mapping?.slot_capacity ?? null,
      applies_to_configs: mapping?.applies_to_configs ?? [],
    };
  });

  if (unmappedMasters.length > 0) {
    console.warn(
      `[upload] Warning: ${unmappedMasters.length} master(s) have no family mapping ` +
        `(family_id will be NULL, won't be used by rule engine): ${unmappedMasters.join(', ')}`,
    );
  }

  const { error: insertSpreadsError } = await supabaseAdmin
    .from('spread_templates')
    .insert(spreadRows);

  // ─── 8. Best-effort откат при сбое batch insert ──────────────────
  // Откат удаляет template_set ТОЛЬКО если он был только что создан (не reuse).
  // При reuse откат невозможен — старые spreads уже удалены, а сам template_set
  // мог ссылаться на album_layouts (FK violation). В этом случае состояние
  // остаётся неконсистентным (template_set без spreads), требуется ручное
  // вмешательство или повтор upload.
  if (insertSpreadsError) {
    if (reusedTemplateSetId !== null) {
      console.error(
        `[upload] Failed to insert spread_templates: ${insertSpreadsError.message}. ` +
          `template_set ${templateSetId} was reused, NOT rolled back. ` +
          `BD now has template_set without spreads. Re-run upload to recover.`,
      );
      throw new Error(`Failed to insert spread_templates: ${insertSpreadsError.message}`);
    }
    console.error(
      `[upload] Failed to insert spread_templates: ${insertSpreadsError.message}. ` +
        `Rolling back newly created template_set ${templateSetId}…`,
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

/**
 * Этап 2б ТЗ: загрузка embedded-картинок привязанного декора в storage.
 *
 * Проходит по всем placeholder'ам type:'decoration' с транзитным `_embedded`,
 * декодирует base64 → Buffer, грузит в bucket template-decorations,
 * проставляет публичный `url` и УДАЛЯЕТ `_embedded` (чтобы base64 не попал в
 * jsonb-колонку placeholders и не раздул строки spread_templates).
 *
 * Путь файла стабилен по (templateSetId, имя мастера, label) → при повторной
 * загрузке (--force) upsert:true перезаписывает картинку, а не плодит дубли.
 * Имена санитизируются (только [a-z0-9._-]) — спецсимволы/кириллица из имён
 * мастеров сломали бы storage key.
 *
 * Мутирует parsed на месте. При ошибке загрузки — throw (декор без картинки
 * бесполезен; неполный template_set лучше явно провалить, чем тихо испортить).
 */
async function uploadDecorationImages(
  parsed: ParsedTemplateSet,
  templateSetId: string,
  supabaseAdmin: SupabaseClient,
): Promise<void> {
  let uploaded = 0;
  for (const spread of parsed.spread_templates) {
    for (const ph of spread.placeholders) {
      if (ph.type !== 'decoration') continue;
      const decor = ph as DecorationPlaceholder;
      const embedded = decor._embedded;
      if (!embedded) continue; // декор уже с url (или парсер не дал картинку)

      const ext = embedded.format === 'jpeg' ? 'jpg' : 'png';
      const contentType = embedded.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const path = `${templateSetId}/${sanitizePart(spread.name)}/${sanitizePart(decor.label)}.${ext}`;
      const buffer = Buffer.from(embedded.base64, 'base64');

      const { error: uploadError } = await supabaseAdmin.storage
        .from(DECORATIONS_BUCKET)
        .upload(path, buffer, { contentType, upsert: true });
      if (uploadError) {
        throw new Error(
          `Failed to upload decoration image ${path}: ${uploadError.message}`,
        );
      }

      const { data } = supabaseAdmin.storage
        .from(DECORATIONS_BUCKET)
        .getPublicUrl(path);
      decor.url = data.publicUrl;
      delete decor._embedded;
      uploaded += 1;
    }
  }
  if (uploaded > 0) {
    console.log(`[upload] Uploaded ${uploaded} decoration image(s) to ${DECORATIONS_BUCKET}`);
  }
}

/** Санитизация части пути в storage: оставляем только [a-z0-9._-]. */
function sanitizePart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}
