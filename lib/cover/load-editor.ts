/**
 * Загрузка данных для РЕДАКТОРА обложек (ТЗ tz-cover-editor): все обложки заказа
 * по группировке assembleCovers + геометрия мастеров + слитые правки
 * (cover_edits) + галерея общих фото для замены.
 *
 * Только чтение/сборка. Сохранение правок — отдельный эндпоинт (cover_save_edit).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPhotoUrl } from '@/lib/supabase';
import { storageBackend, resolveReadUrl, signDecorPlaceholders } from '@/lib/blob-storage';
import { resignCoverPhotoData } from './resign-photos';
import type { RenderPlaceholder } from '../album-builder/types';
import { loadAlbumCovers } from './load-covers';
import {
  indexCoverEdits,
  mergeCoverEditsInto,
  COVER_BG_KEY,
  type CoverEditRow,
} from './editor-merge';
import { parseCoverTextStyleOverrides, type CoverTextStyleOverrides } from './text-styles';
import type { CoverType } from './types';

export type CoverEditorMaster = {
  placeholders: RenderPlaceholder[];
  back_width_mm: number | null;
  front_width_mm: number | null;
  height_mm: number | null;
  nominal_spine_width_mm: number | null;
  background_url: string | null;
};

export type CoverEditorItem = {
  /** Уникальный ключ строки редактора. */
  key: string;
  child_id: string | null;
  child_name: string | null;
  cover_id: string | null;
  cover_type: CoverType;
  cover_name: string | null;
  has_cover: boolean;
  master: CoverEditorMaster | null;
  /** Слитые данные (база ⊕ шаблонные ⊕ поштучные) — для миниатюры. */
  data: Record<string, string | null>;
  /** Базовые данные сборки (без правок) — основа для редактирования. */
  base: Record<string, string | null>;
};

export type CoverEditorResult = {
  items: CoverEditorItem[];
  spine_width_mm: number | null;
  /** Сырые правки по типу и по ученику (для патчей редактора). */
  editsByType: Record<string, Record<string, string | null>>;
  editsByChild: Record<string, Record<string, string | null>>;
  /** Глобальные стили текстов обложки (albums.cover_text_style_overrides). */
  coverTextStyles: CoverTextStyleOverrides;
  /** Галерея общих фото класса (для замены на общей/учительской). */
  common_photos: Array<{ id: string; url: string }>;
  /**
   * Доступные фоны обложек этого дизайна (фоны обложек того же template_set) —
   * для панели «Фон» в редакторе. Уникальны по URL.
   */
  available_backgrounds: Array<{ url: string; name: string }>;
  /**
   * Переезд на Timeweb: карта «ключ фона → signed URL» (только режим timeweb;
   * иначе undefined → клиент строит/использует URL как раньше). Покрывает
   * available_backgrounds, фоны мастеров и значения правок __bg__. Сами ключи
   * (available_backgrounds[].url, master.background_url, __bg__) НЕ меняем —
   * сохранение/сравнение работают на ключах, подпись только для показа.
   */
  bgSigned?: Record<string, string>;
  warnings: string[];
};

export async function loadCoverEditor(
  supabase: SupabaseClient,
  albumId: string,
): Promise<CoverEditorResult> {
  const assembled = await loadAlbumCovers(supabase, albumId);

  // Геометрия мастеров.
  const coverIds = Array.from(
    new Set(assembled.covers.map((c) => c.cover_id).filter(Boolean)),
  ) as string[];
  const masters = new Map<string, CoverEditorMaster>();
  if (coverIds.length > 0) {
    const { data } = await supabase
      .from('covers')
      .select('id, placeholders, back_width_mm, front_width_mm, height_mm, nominal_spine_width_mm, background_url')
      .in('id', coverIds);
    for (const m of (data ?? []) as Array<Record<string, unknown>>) {
      masters.set(m.id as string, {
        placeholders: (Array.isArray(m.placeholders) ? m.placeholders : []) as RenderPlaceholder[],
        back_width_mm: (m.back_width_mm as number | null) ?? null,
        front_width_mm: (m.front_width_mm as number | null) ?? null,
        height_mm: (m.height_mm as number | null) ?? null,
        nominal_spine_width_mm: (m.nominal_spine_width_mm as number | null) ?? null,
        background_url: (m.background_url as string | null) ?? null,
      });
    }
  }

  // Имена учеников.
  const childIds = assembled.covers.map((c) => c.child_id).filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (childIds.length > 0) {
    const { data } = await supabase.from('children').select('id, full_name').in('id', childIds);
    for (const c of (data ?? []) as Array<{ id: string; full_name: string }>) names.set(c.id, c.full_name);
  }

  // Правки редактора.
  const { data: editRows } = await supabase
    .from('cover_edits')
    .select('cover_type, child_id, data')
    .eq('album_id', albumId);
  const { byType, byChild } = indexCoverEdits((editRows ?? []) as CoverEditRow[]);

  // Глобальные стили текстов обложки + дизайн заказа (для списка фонов).
  const { data: albumRow } = await supabase
    .from('albums')
    .select('cover_text_style_overrides, template_set_id')
    .eq('id', albumId)
    .maybeSingle();
  const coverTextStyles = parseCoverTextStyleOverrides(
    (albumRow as { cover_text_style_overrides?: unknown } | null)?.cover_text_style_overrides,
  );
  const designTemplateSetId =
    (albumRow as { template_set_id?: string | null } | null)?.template_set_id ?? null;

  // Доступные фоны: фоны обложек того же дизайна (template_set) + фоны самих
  // мастеров, уже назначенных на обложки заказа. Уникальны по URL.
  const bgMap = new Map<string, string>(); // url → имя
  for (const m of Array.from(masters.values())) {
    if (m.background_url) bgMap.set(m.background_url, 'Текущий фон обложки');
  }
  if (designTemplateSetId) {
    const { data: designCovers } = await supabase
      .from('covers')
      .select('name, background_url')
      .eq('template_set_id', designTemplateSetId)
      .not('background_url', 'is', null);
    for (const c of (designCovers ?? []) as Array<{ name: string | null; background_url: string | null }>) {
      if (c.background_url && !bgMap.has(c.background_url)) {
        bgMap.set(c.background_url, c.name ?? 'Фон дизайна');
      }
    }
  }
  const available_backgrounds = Array.from(bgMap.entries()).map(([url, name]) => ({ url, name }));

  // Переезд на Timeweb: подпись картинок обложки для приватного бакета.
  // Декор мастеров (статичен) подписываем на месте; для фонов отдаём карту
  // ключ→signed (клиент конвертирует при показе, сохраняет ключ).
  let bgSigned: Record<string, string> | undefined;
  if (storageBackend() === 'timeweb') {
    // 1. Декор-картинки в плейсхолдерах мастеров.
    for (const m of Array.from(masters.values())) {
      m.placeholders = (await signDecorPlaceholders(
        m.placeholders as Array<{ type?: string; url?: string | null }>,
      )) as RenderPlaceholder[];
    }
    // 2. Карта подписей фонов: available + фоны мастеров + значения правок __bg__.
    const bgKeys = new Set<string>();
    for (const b of available_backgrounds) if (b.url) bgKeys.add(b.url);
    for (const m of Array.from(masters.values())) if (m.background_url) bgKeys.add(m.background_url);
    for (const edits of [...Object.values(byType), ...Object.values(byChild)]) {
      const ov = edits[COVER_BG_KEY];
      // 'none'/'' — сентинелы «без фона», подписывать нечего.
      if (typeof ov === 'string' && ov && ov !== 'none') bgKeys.add(ov);
    }
    const keys = Array.from(bgKeys);
    const signed = await Promise.all(
      keys.map((k) => resolveReadUrl('template-backgrounds', k)),
    );
    bgSigned = {};
    keys.forEach((k, i) => { bgSigned![k] = signed[i]; });
  }

  // Галерея общих фото класса (для замены).
  const { data: commonsRaw } = await supabase
    .from('photos')
    .select('id, storage_path, thumb_path, created_at')
    .eq('album_id', albumId)
    .eq('type', 'common_full')
    .order('created_at', { ascending: false });
  const common_photos: Array<{ id: string; url: string }> = [];
  for (const p of (commonsRaw ?? []) as Array<Record<string, unknown>>) {
    const path = (p.thumb_path as string | null) ?? (p.storage_path as string | null);
    if (path) common_photos.push({ id: p.id as string, url: await getPhotoUrl(path) });
  }

  const items: CoverEditorItem[] = await Promise.all(
    assembled.covers.map(async (inst) => {
      const merged = mergeCoverEditsInto(
        { child_id: inst.child_id, cover_type: inst.cover_type, data: inst.data },
        byType,
        byChild,
      );
      // Пере-подпись фото-меток: в cover_edits мог лежать протухший presigned-URL
      // (срок 24ч) → битый портрет/логотип на холсте. Достаём ключ, подписываем заново.
      const data = await resignCoverPhotoData(merged.data);
      return {
        key: inst.child_id ?? `type:${inst.cover_type}`,
        child_id: inst.child_id,
        child_name: inst.child_id ? names.get(inst.child_id) ?? null : null,
        cover_id: inst.cover_id,
        cover_type: inst.cover_type,
        cover_name: inst.cover_name,
        has_cover: !!inst.cover_id && masters.has(inst.cover_id),
        master: inst.cover_id ? masters.get(inst.cover_id) ?? null : null,
        data,
        base: inst.data,
      };
    }),
  );

  return {
    items,
    spine_width_mm: assembled.spine_width_mm,
    editsByType: byType,
    editsByChild: byChild,
    coverTextStyles,
    common_photos,
    available_backgrounds,
    bgSigned,
    warnings: assembled.warnings,
  };
}
