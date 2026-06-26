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
import sharp from 'sharp';
import { getFamilyMapping } from './family-mapping';
import { matchCanonType, type CanonType, type CanonMatchReason } from './canon-match';
import { serverUpload, storedValue } from '@/lib/blob-storage';
import type {
  DecorationPlaceholder,
  ParsedTemplateSet,
  PhotoPlaceholder,
} from './types';

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

/** Фаза 2: отчёт сверки загруженных мастеров с каноном master_page_types. */
export type CanonReport = {
  /** Сколько мастеров распознано каноном (matched). */
  recognized: number;
  /** Всего мастеров (не считая cover). */
  total: number;
  /** Не легло: имя мастера + причина (unmapped / no-canon-type). */
  unmatched: Array<{ name: string; reason: CanonMatchReason }>;
};

export type UploadResult = {
  template_set_id: string;
  spread_count: number;
  /** Фаза 2: сверка с каноном (МЯГКИЙ режим — не влияет на успех загрузки). */
  canon_report: CanonReport;
  /**
   * Имена cover-мастеров (type='cover'), которые НЕ записаны в spread_templates.
   * Запись обложек в таблицу `covers` + UI библиотеки — Этап 6 ТЗ обложки.
   */
  skipped_cover_masters?: string[];
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
  const decorDominant = await uploadDecorationImages(parsed, templateSetId, supabaseAdmin);

  // ─── 6.6. Цвет свечения фото-фреймов (Часть 2 ТЗ, Этап 6б) ────────
  // У фото-фрейма со свечением (glow_size_pt) в IDML НЕТ цвета свечения —
  // берём доминирующий цвет привязанного к нему декора (зелёная ленточка →
  // зелёное свечение). decorDominant: Map<attached_to label → hex>.
  applyGlowColors(parsed, decorDominant);

  // ─── 7. Batch INSERT spread_templates ────────────────────────────
  // Поля family_id / page_type / density / params проставляются
  // через family-mapping.ts (РЭ.3.5). Если имя мастера неизвестно —
  // эти поля остаются NULL/{}, мастер всё равно загрузится, но не
  // попадёт в правила rule engine пока админ не проставит вручную.
  // Обложки (type='cover') пока НЕ пишем в spread_templates — у них своя
  // таблица covers (Этап 1 ТЗ обложки) и отдельный путь загрузки (Этап 6).
  // Исключаем здесь, чтобы не засорять внутренние мастера набора.
  const coverMasters = parsed.spread_templates.filter((s) => s.type === 'cover');
  const innerMasters = parsed.spread_templates.filter((s) => s.type !== 'cover');
  if (coverMasters.length > 0) {
    console.warn(
      `[upload] ${coverMasters.length} cover-мастер(ов) пропущено (не пишутся в ` +
        `spread_templates, ждут таблицы covers / Этап 6): ` +
        coverMasters.map((s) => s.name).join(', '),
    );
  }

  // ─── Сверка с каноном master_page_types (Фаза 2, МЯГКИЙ режим) ──────
  // Загружаем канон ОДИН раз (не в цикле). При сбое — пустой канон: загрузка
  // НЕ блокируется, просто все мастера уйдут в unmatched (reason no-canon-type).
  // Логика матча — lib/idml-converter/canon-match.ts (= backfill Фазы 1).
  const { data: canonRows, error: canonError } = await supabaseAdmin
    .from('master_page_types')
    .select('id, code, page_role, slot_capacity, page_type');
  if (canonError) {
    console.warn(`[upload] canon load failed (мягко продолжаем без сверки): ${canonError.message}`);
  }
  const canon: CanonType[] = (canonRows ?? []) as CanonType[];

  const unmappedMasters: string[] = [];
  const canonUnmatched: Array<{ name: string; reason: CanonMatchReason }> = [];

  const spreadRows = innerMasters.map((spread, index) => {
    const mapping = getFamilyMapping(spread.name);
    if (!mapping) {
      unmappedMasters.push(spread.name);
    }
    // Сверка с каноном по тем же тегам, что пишем в строку.
    const canonMatch = matchCanonType(
      {
        page_role: mapping?.page_role ?? null,
        slot_capacity: mapping?.slot_capacity ?? null,
        page_type: mapping?.page_type ?? 'page-any',
      },
      canon,
    );
    if (canonMatch.reason !== 'matched') {
      canonUnmatched.push({ name: spread.name, reason: canonMatch.reason });
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
      // ─── Фаза 2: ссылка на канон (МЯГКО — null не блокирует загрузку) ──
      master_page_type_id: canonMatch.master_page_type_id,
    };
  });

  // Отчёт сверки с каноном (включает и unmapped, и no-canon-type — не дублируем
  // unmappedMasters в ответе, он остаётся только для серверного лога ниже).
  const canonReport = {
    recognized: spreadRows.length - canonUnmatched.length,
    total: spreadRows.length,
    unmatched: canonUnmatched,
  };

  if (unmappedMasters.length > 0) {
    console.warn(
      `[upload] Warning: ${unmappedMasters.length} master(s) have no family mapping ` +
        `(family_id will be NULL, won't be used by rule engine): ${unmappedMasters.join(', ')}`,
    );
  }
  console.log(
    `[upload] canon: распознано ${canonReport.recognized}/${canonReport.total}` +
      (canonUnmatched.length
        ? `, не легло: ${canonUnmatched.map((u) => `${u.name}(${u.reason})`).join(', ')}`
        : ''),
  );

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
    spread_count: spreadRows.length,
    // Фаза 2: отчёт сверки с каноном (МЯГКИЙ режим — не влияет на успех загрузки).
    canon_report: canonReport,
    ...(coverMasters.length > 0
      ? { skipped_cover_masters: coverMasters.map((s) => s.name) }
      : {}),
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
 *
 * Возвращает Map<attached_to label → доминирующий hex картинки декора> —
 * используется applyGlowColors для подбора цвета свечения фото-фреймов
 * (Часть 2 ТЗ, Этап 6б). Ключ — attached_to (label базового слота); если к
 * одному слоту привязано несколько декоров, берётся первый с распознанным
 * цветом. foreground-декор (attached_to='') в карту не попадает.
 */
async function uploadDecorationImages(
  parsed: ParsedTemplateSet,
  templateSetId: string,
  supabaseAdmin: SupabaseClient,
): Promise<Map<string, string>> {
  let uploaded = 0;
  const dominantByAttached = new Map<string, string>();
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

      await serverUpload('template-decorations', path, buffer, contentType, supabaseAdmin);
      decor.url = storedValue('template-decorations', path);

      // Доминирующий цвет картинки декора для свечения фото-фрейма (6б).
      // Best-effort: ошибка sharp не должна валить загрузку набора.
      if (decor.attached_to && !dominantByAttached.has(decor.attached_to)) {
        const hex = await dominantHex(buffer);
        if (hex) dominantByAttached.set(decor.attached_to, hex);
      }

      delete decor._embedded;
      uploaded += 1;
    }
  }
  if (uploaded > 0) {
    console.log(`[upload] Uploaded ${uploaded} decoration image(s) to ${DECORATIONS_BUCKET}`);
  }
  return dominantByAttached;
}

/**
 * Этап 6б ТЗ: подбор цвета свечения фото-фреймов.
 *
 * Фото-фрейм с заданным glow_size_pt, но без glow_color (типично — IDML не
 * экспортирует цвет внешнего свечения), получает доминирующий цвет привязанного
 * к нему декора. Если декора нет (нет записи в карте) — glow_color остаётся
 * пустым, и рендер свечение не рисует.
 *
 * Мутирует parsed на месте.
 */
function applyGlowColors(
  parsed: ParsedTemplateSet,
  dominantByAttached: ReadonlyMap<string, string>,
): void {
  for (const spread of parsed.spread_templates) {
    for (const ph of spread.placeholders) {
      if (ph.type !== 'photo') continue;
      const photo = ph as PhotoPlaceholder;
      if (!photo.glow_size_pt || photo.glow_color) continue;
      const hex = dominantByAttached.get(photo.label);
      if (hex) photo.glow_color = hex;
    }
  }
}

/**
 * Доминирующий цвет картинки → '#rrggbb'. Через sharp .stats().dominant.
 * Возвращает null при ошибке (best-effort — не валит загрузку набора).
 */
async function dominantHex(buffer: Buffer): Promise<string | null> {
  try {
    const { dominant } = await sharp(buffer).stats();
    const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${h(dominant.r)}${h(dominant.g)}${h(dominant.b)}`;
  } catch {
    return null;
  }
}

/** Санитизация части пути в storage: оставляем только [a-z0-9._-]. */
function sanitizePart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}
