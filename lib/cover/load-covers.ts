/**
 * Загрузка данных для сборки обложек из Supabase — Этап 4 (ТЗ
 * docs/tz-cover-design.md). Читает cover-поля заказа, учеников, их фото-выборы,
 * выбор обложки родителем, библиотеку обложек; считает общий текст и ширину
 * корешка (Этап 3); вызывает движок assembleCovers.
 *
 * Не вызывается из роутов на Этапе 4 — это фундамент для UI (Этапы 6-8).
 * Живая проверка — после применения миграции 2026-06-02-cover-foundation.sql
 * и появления реальных cover-мастеров в таблице covers.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPhotoUrl } from '@/lib/supabase';
import type { SpreadInstance, SpreadTemplate } from '../album-builder/types';
import {
  assembleCovers,
  type CoverInstance,
  type CoverStudentInput,
  type CoverSharedContent,
} from './assemble';
import { resolveAlbumSpineWidthMm } from './album-spine';
import type { Cover, CoverType, PrintSpec } from './types';

export type AssembledCoversResult = {
  covers: CoverInstance[];
  /** Ширина корешка в мм. null = не задан пресет печати. */
  spine_width_mm: number | null;
  warnings: string[];
};

/**
 * Год для подзаголовка обложки. Берём из дедлайна заказа, иначе из даты
 * создания. Используется как cover_subtitle по умолчанию (партнёр может
 * переопределить в редакторе позже).
 */
function albumYear(deadline: string | null, createdAt: string | null): string | null {
  const src = deadline ?? createdAt;
  if (!src) return null;
  const y = new Date(src).getFullYear();
  return Number.isFinite(y) ? String(y) : null;
}

export async function loadAlbumCovers(
  supabase: SupabaseClient,
  albumId: string,
): Promise<AssembledCoversResult> {
  const warnings: string[] = [];

  // ── 1. Заказ + cover-поля ────────────────────────────────────────────────
  const { data: album, error: albumErr } = await supabase
    .from('albums')
    .select(
      'id, title, classes, tenant_id, template_set_id, deadline, created_at, ' +
        'cover_layout_mode, cover_default_type, cover_available_ids, ' +
        'print_preset_id, sheet_type_id',
    )
    .eq('id', albumId)
    .single();
  if (albumErr || !album) {
    throw new Error(`album ${albumId} not found: ${albumErr?.message ?? 'no row'}`);
  }

  const a = album as unknown as Record<string, unknown>;
  const mode = (a.cover_layout_mode as 'fixed' | 'default_editable' | 'parent_choice' | null) ?? null;
  const defaultType = (a.cover_default_type as CoverType | null) ?? null;
  if (!mode || !defaultType) {
    // Обложка на заказе не настроена — собирать нечего.
    return {
      covers: [],
      spine_width_mm: null,
      warnings: ['обложка на заказе не настроена (cover_layout_mode/cover_default_type пусты)'],
    };
  }
  const availableIds = ((a.cover_available_ids as string[] | null) ?? []).filter(Boolean);

  // ── 2. Ученики ────────────────────────────────────────────────────────────
  const { data: childrenRaw } = await supabase
    .from('children')
    .select('id, full_name, class')
    .eq('album_id', albumId);
  const children = (childrenRaw ?? []) as Array<{ id: string; full_name: string; class: string }>;
  const childIds = children.map((c) => c.id);

  // ── 3. Фото-выборы (портрет + отдельное фото под обложку) ─────────────────
  const albumPortraitByChild: Record<string, string> = {};
  const coverOverrideByChild: Record<string, string> = {};
  if (childIds.length > 0) {
    const { data: sels } = await supabase
      .from('selections')
      .select('child_id, selection_type, photos(storage_path)')
      .in('child_id', childIds)
      .in('selection_type', ['portrait_page', 'portrait_cover']);
    for (const sel of (sels ?? []) as Array<Record<string, unknown>>) {
      const photo = sel.photos as { storage_path?: string } | null;
      if (!photo?.storage_path) continue;
      const cid = sel.child_id as string;
      const url = getPhotoUrl(photo.storage_path);
      if (sel.selection_type === 'portrait_cover') coverOverrideByChild[cid] = url;
      else albumPortraitByChild[cid] = url;
    }
  }

  // ── 4. Выбор обложки родителем (новая система) ────────────────────────────
  const choiceByChild: Record<string, { cover_type: CoverType | null; cover_id: string | null }> = {};
  if (childIds.length > 0) {
    const { data: choices } = await supabase
      .from('cover_choices')
      .select('child_id, cover_type, cover_id')
      .in('child_id', childIds);
    for (const ch of (choices ?? []) as Array<Record<string, unknown>>) {
      choiceByChild[ch.child_id as string] = {
        cover_type: (ch.cover_type as CoverType | null) ?? null,
        cover_id: (ch.cover_id as string | null) ?? null,
      };
    }
  }

  // ── 5. Библиотека обложек: глобальные + свои + опубликованные ──────────────
  const tid = (a.tenant_id as string | null) ?? null;
  let coversQuery = supabase.from('covers').select('*').eq('is_published', true);
  coversQuery = tid
    ? coversQuery.or(`tenant_id.is.null,tenant_id.eq.${tid}`)
    : coversQuery.is('tenant_id', null);
  const { data: coversRaw } = await coversQuery;
  const library = (coversRaw ?? []) as Cover[];
  if (library.length === 0) {
    warnings.push('библиотека обложек пуста (covers): нечего назначить');
  }

  // ── 6. Вход движка ────────────────────────────────────────────────────────
  const students: CoverStudentInput[] = children.map((c) => ({
    child_id: c.id,
    full_name: c.full_name ?? '',
    class: c.class ?? '',
    album_portrait_url: albumPortraitByChild[c.id] ?? null,
    cover_portrait_override_url: coverOverrideByChild[c.id] ?? null,
    choice: choiceByChild[c.id] ?? null,
  }));

  const year = albumYear((a.deadline as string | null) ?? null, (a.created_at as string | null) ?? null);
  const shared: CoverSharedContent = {
    title: (a.title as string | null) ?? null,
    subtitle: year,
    spine_text: (a.title as string | null) ?? null,
    common_photo_url: null,       // общее фото класса — подключим на рендере
    back_common_photo_url: null,
    back_logo_url: null,
    back_contacts: null,
  };

  const covers = assembleCovers(students, { mode, default_type: defaultType, available_cover_ids: availableIds, library }, shared);

  // ── 7. Ширина корешка (Этап 3) — best-effort ──────────────────────────────
  const spine_width_mm = await loadSpineWidth(supabase, a, warnings);

  return { covers, spine_width_mm, warnings };
}

/**
 * Считает ширину корешка для альбома: число листов из сохранённого layout +
 * толщина/запас из пресета печати. null если нет пресета или layout.
 */
async function loadSpineWidth(
  supabase: SupabaseClient,
  album: Record<string, unknown>,
  warnings: string[],
): Promise<number | null> {
  const printPresetId = (album.print_preset_id as string | null) ?? null;
  const templateSetId = (album.template_set_id as string | null) ?? null;
  if (!printPresetId) {
    warnings.push('пресет печати не задан (print_preset_id) — корешок не посчитан');
    return null;
  }

  const { data: presetRow } = await supabase
    .from('config_presets')
    .select('print_spec')
    .eq('id', printPresetId)
    .single();
  const printSpec = ((presetRow as { print_spec?: PrintSpec } | null)?.print_spec ?? null) as PrintSpec | null;
  if (!printSpec) {
    warnings.push('у пресета печати нет print_spec — корешок не посчитан');
    return null;
  }

  // Последний сохранённый layout альбома.
  const { data: layoutRow } = await supabase
    .from('album_layouts')
    .select('spreads')
    .eq('album_id', album.id as string)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const spreads = ((layoutRow as { spreads?: SpreadInstance[] } | null)?.spreads ?? []) as SpreadInstance[];
  if (spreads.length === 0) {
    warnings.push('нет сохранённого layout — число листов неизвестно, корешок не посчитан');
    return null;
  }

  // Карта is_spread по мастерам набора (для подсчёта разворотов).
  const templatesById = new Map<string, SpreadTemplate>();
  if (templateSetId) {
    const { data: tpls } = await supabase
      .from('spread_templates')
      .select('id, is_spread')
      .eq('template_set_id', templateSetId);
    for (const t of (tpls ?? []) as Array<{ id: string; is_spread: boolean }>) {
      templatesById.set(t.id, { is_spread: t.is_spread } as SpreadTemplate);
    }
  }

  return resolveAlbumSpineWidthMm(spreads, templatesById, printSpec, (album.sheet_type_id as string | null) ?? null);
}
