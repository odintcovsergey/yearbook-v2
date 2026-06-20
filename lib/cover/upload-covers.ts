/**
 * Запись cover-мастеров из IDML в таблицу `covers` — Этап 6а
 * (ТЗ docs/tz-cover-design.md).
 *
 * Парсер (parseIdml) уже понимает обложку (type='cover', cover_zones, метки).
 * Здесь cover-мастера из разобранного IDML кладутся в библиотеку обложек:
 * выводим тип/пол из имени, грузим embedded-декор в storage, пишем строку.
 *
 * Отдельно от uploadTemplateSetToSupabase: у обложек своя таблица и геометрия
 * трёх зон. Внутренние мастера сюда не попадают.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DecorationPlaceholder,
  ParsedSpreadTemplate,
  ParsedTemplateSet,
} from '../idml-converter/types';
import type { CoverGenderHint, CoverType } from './types';
import { serverUpload, storedValue } from '@/lib/blob-storage';

/** Bucket для embedded-картинок декора (общий с шаблонами). */

export type CoverUploadMeta = {
  /** null = глобальная обложка (видна всем). UUID = обложка тенанта. */
  tenantId: string | null;
  /**
   * UUID дизайна (template_set). Если задан — обложка РОДНАЯ для дизайна:
   * template_set_id заполнен, is_global=false (видна только своему дизайну).
   * null = библиотечная (дизайнерская) обложка.
   */
  templateSetId?: string | null;
  /** Публиковать сразу (видна в выборе). По умолчанию false (черновик). */
  isPublished?: boolean;
  /** Перезаписать обложку с тем же (tenant, template_set, slug). */
  force?: boolean;
};

export type CoverUploadResult = {
  cover_ids: string[];
  cover_count: number;
  names: string[];
  warnings: string[];
};

/**
 * slug обложки из имени мастера: lowercase, только [a-z0-9-].
 * Кириллица/спецсимволы → '-'. Пустой → 'cover'.
 */
export function coverSlug(masterName: string): string {
  const s = masterName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'cover';
}

/**
 * Выводит тип обложки и подсказку пола из имени мастера + плейсхолдеров.
 *
 * По имени (C-Cover-Portrait, C-Cover-Design-Boys, ...): 'portrait' →
 * portrait_photo, 'common' → common_photo, 'design' → design_only.
 * Если по имени не ясно — смотрим метки: cover_portrait → portrait_photo,
 * cover_common_photo → common_photo, иначе design_only.
 * Пол: boy/мальч → boys, girl/девоч → girls, neutral/нейтр → neutral.
 */
export function deriveCoverType(
  masterName: string,
  placeholders: ReadonlyArray<{ label: string }>,
): { cover_type: CoverType; gender_hint: CoverGenderHint | null } {
  const n = masterName.toLowerCase();
  const labels = new Set(placeholders.map((p) => p.label.toLowerCase()));

  let cover_type: CoverType;
  if (n.includes('portrait')) cover_type = 'portrait_photo';
  else if (n.includes('common')) cover_type = 'common_photo';
  else if (n.includes('design')) cover_type = 'design_only';
  else if (labels.has('cover_portrait')) cover_type = 'portrait_photo';
  else if (labels.has('cover_common_photo')) cover_type = 'common_photo';
  else cover_type = 'design_only';

  let gender_hint: CoverGenderHint | null = null;
  if (/boy|мальч/.test(n)) gender_hint = 'boys';
  else if (/girl|девоч/.test(n)) gender_hint = 'girls';
  else if (/neutral|нейтр/.test(n)) gender_hint = 'neutral';

  return { cover_type, gender_hint };
}

/**
 * Строит строку для INSERT в covers из одного cover-мастера. Чистая функция
 * (без БД) — тестируется отдельно. Декор-url'ы должны быть уже проставлены.
 */
export function buildCoverRow(
  master: ParsedSpreadTemplate,
  meta: CoverUploadMeta,
): Record<string, unknown> {
  const { cover_type, gender_hint } = deriveCoverType(master.name, master.placeholders);
  const zones = master.cover_zones ?? null;
  const templateSetId = meta.templateSetId ?? null;

  return {
    tenant_id: meta.tenantId,
    // Глобальная (дизайнерская библиотека) — только если НЕ привязана к дизайну
    // И не принадлежит тенанту. Родная обложка дизайна → is_global=false.
    is_global: templateSetId === null && meta.tenantId === null,
    template_set_id: templateSetId,
    name: master.name,
    slug: coverSlug(master.name),
    cover_type,
    gender_hint,
    variant_label: master.name,
    back_width_mm: zones?.back_width_mm ?? null,
    front_width_mm: zones?.front_width_mm ?? null,
    height_mm: master.height_mm ?? null,
    nominal_spine_width_mm: zones?.spine_width_mm ?? null,
    placeholders: master.placeholders,
    is_published: meta.isPublished ?? false,
  };
}

/**
 * Грузит embedded-картинки декора cover-мастера в storage, проставляет url,
 * удаляет _embedded (чтобы base64 не попал в jsonb). Путь по (prefix, label).
 * Мутирует placeholders на месте. При ошибке — throw.
 */
async function uploadCoverDecor(
  master: ParsedSpreadTemplate,
  pathPrefix: string,
  supabase: SupabaseClient,
): Promise<void> {
  for (const ph of master.placeholders) {
    if (ph.type !== 'decoration') continue;
    const decor = ph as DecorationPlaceholder;
    const embedded = decor._embedded;
    if (!embedded) continue;

    const ext = embedded.format === 'jpeg' ? 'jpg' : 'png';
    const contentType = embedded.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const path = `${pathPrefix}/${sanitizePart(decor.label)}.${ext}`;
    const buffer = Buffer.from(embedded.base64, 'base64');

    await serverUpload('template-decorations', path, buffer, contentType, supabase);
    decor.url = storedValue('template-decorations', path);
    delete decor._embedded;
  }
}

/**
 * Записывает cover-мастера разобранного IDML в таблицу covers.
 * Внутренние мастера (type !== 'cover') игнорируются.
 */
export async function uploadCoversToSupabase(
  parsed: ParsedTemplateSet,
  meta: CoverUploadMeta,
  supabase: SupabaseClient,
): Promise<CoverUploadResult> {
  const warnings: string[] = [];
  const coverMasters = parsed.spread_templates.filter((s) => s.type === 'cover');
  if (coverMasters.length === 0) {
    return { cover_ids: [], cover_count: 0, names: [], warnings: ['в IDML нет обложек (мастеров C-*)'] };
  }

  const cover_ids: string[] = [];
  const names: string[] = [];

  for (const master of coverMasters) {
    if (!master.cover_zones) {
      warnings.push(`«${master.name}»: зоны не распознаны (не 3-страничный разворот) — корешок не задан`);
    }

    const slug = coverSlug(master.name);
    const tenantKey = meta.tenantId ?? 'global';
    await uploadCoverDecor(master, `${tenantKey}/${slug}`, supabase);

    // Перезапись: удаляем существующую обложку того же (tenant, template_set, slug).
    if (meta.force) {
      let del = supabase.from('covers').delete().eq('slug', slug);
      del = meta.tenantId ? del.eq('tenant_id', meta.tenantId) : del.is('tenant_id', null);
      del = meta.templateSetId
        ? del.eq('template_set_id', meta.templateSetId)
        : del.is('template_set_id', null);
      const { error: delErr } = await del;
      if (delErr) {
        throw new Error(`Failed to replace cover ${slug}: ${delErr.message}`);
      }
    }

    const row = buildCoverRow(master, meta);
    const { data, error } = await supabase.from('covers').insert(row).select('id').single();
    if (error || !data) {
      throw new Error(`Failed to insert cover ${master.name}: ${error?.message ?? 'no row'}`);
    }
    cover_ids.push((data as { id: string }).id);
    names.push(master.name);
  }

  return { cover_ids, cover_count: cover_ids.length, names, warnings };
}

/** Санитизация части пути storage: только [a-z0-9._-]. */
function sanitizePart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}
