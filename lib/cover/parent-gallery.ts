/**
 * Галерея обложек для РОДИТЕЛЯ — Объединение, Этап 3 (ТЗ docs/tz-cover-design.md).
 *
 * Отдаёт родителю список доступных обложек (albums.cover_available_ids) с
 * превью, персонализированными под его ребёнка (ФИО/школа/город/год/класс +
 * портрет на портретных обложках). Плюс параметры доплаты, чтобы экран показал
 * правильные цены.
 *
 * Активна только когда обложка на заказе настроена (cover_layout_mode задан) и
 * выбраны доступные обложки. Иначе active=false → родитель видит старый поток
 * «Портрет для обложки» (см. app/[token]/page.tsx). Связку уберём на этапе 4.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPhotoUrl } from '@/lib/supabase';
import type { Placeholder } from '../album-builder/types';
import { renderCoverMasterSvg, type CoverMasterRow } from './preview-album';
import type {
  Cover,
  CoverType,
  CoverLayoutMode,
  CoverGenderHint,
  CoverPortraitCharge,
} from './types';

export type CoverGalleryItem = {
  id: string;
  name: string;
  cover_type: CoverType;
  gender_hint: CoverGenderHint | null;
  variant_label: string | null;
  /** SVG-превью полотна (схематичное: фон/декор пока не рендерятся). */
  svg: string;
};

export type CoverGalleryResult = {
  /** false = обложка на заказе не настроена → родитель идёт старым потоком. */
  active: boolean;
  layout_mode: CoverLayoutMode | null;
  default_type: CoverType | null;
  /** Обложка по умолчанию (для fixed/дефолта) — первая подходящего типа. */
  default_cover_id: string | null;
  /** Когда брать доплату за портрет на обложке. */
  portrait_charge: CoverPortraitCharge | null;
  /** Сумма доплаты (₽). */
  price: number;
  items: CoverGalleryItem[];
};

const INACTIVE: CoverGalleryResult = {
  active: false,
  layout_mode: null,
  default_type: null,
  default_cover_id: null,
  portrait_charge: null,
  price: 0,
  items: [],
};

/**
 * Собирает галерею обложек для конкретного ребёнка. childId нужен, чтобы
 * подставить его ФИО/класс/портрет в превью; без него превью — с заглушками.
 */
export async function buildCoverGallery(
  supabase: SupabaseClient,
  albumId: string,
  childId?: string | null,
): Promise<CoverGalleryResult> {
  const { data: album } = await supabase
    .from('albums')
    .select(
      'id, title, classes, city, year, school_name, tenant_id, deadline, created_at, ' +
        'cover_layout_mode, cover_default_type, cover_available_ids, ' +
        'cover_portrait_charge, cover_price',
    )
    .eq('id', albumId)
    .single();
  if (!album) return INACTIVE;

  const a = album as unknown as Record<string, unknown>;
  const layoutMode = (a.cover_layout_mode as CoverLayoutMode | null) ?? null;
  const availableIds = ((a.cover_available_ids as string[] | null) ?? []).filter(Boolean);
  // Спит, пока партнёр не настроил режим и не выбрал обложки.
  if (!layoutMode || availableIds.length === 0) return INACTIVE;

  const defaultType = (a.cover_default_type as CoverType | null) ?? null;
  const portraitCharge = (a.cover_portrait_charge as CoverPortraitCharge | null) ?? null;
  const price = num(a.cover_price);

  // Библиотека: только выбранные партнёром + опубликованные + в скоупе tenant.
  const tid = (a.tenant_id as string | null) ?? null;
  let q = supabase.from('covers').select('*').in('id', availableIds).eq('is_published', true);
  q = tid ? q.or(`tenant_id.is.null,tenant_id.eq.${tid}`) : q.is('tenant_id', null);
  const { data: coversRaw } = await q;
  const library = (coversRaw ?? []) as Cover[];
  if (library.length === 0) return { ...INACTIVE, active: false };

  // Данные для персонализации превью (текст + портрет ребёнка).
  const data = await buildPreviewData(supabase, a, childId ?? null);

  // Сохраняем порядок выбора партнёра (availableIds), отбрасываем неопубликованные.
  const byId = new Map(library.map((c) => [c.id, c]));
  const items: CoverGalleryItem[] = [];
  for (const id of availableIds) {
    const c = byId.get(id);
    if (!c) continue;
    const master: CoverMasterRow = {
      id: c.id,
      placeholders: (c.placeholders as Placeholder[] | null) ?? [],
      back_width_mm: c.back_width_mm,
      front_width_mm: c.front_width_mm,
      height_mm: c.height_mm,
      nominal_spine_width_mm: (c as unknown as { nominal_spine_width_mm: number | null }).nominal_spine_width_mm ?? null,
      background_url: c.background_url ?? null,
    };
    items.push({
      id: c.id,
      name: c.name,
      cover_type: c.cover_type,
      gender_hint: c.gender_hint,
      variant_label: c.variant_label,
      // Портрет показываем только на портретных обложках.
      svg: await renderCoverMasterSvg(master, null, c.cover_type === 'portrait_photo' ? data : textOnly(data)),
    });
  }

  // Обложка по умолчанию: первая подходящего типа, иначе просто первая.
  const defaultItem =
    (defaultType && items.find((i) => i.cover_type === defaultType)) || items[0] || null;

  return {
    active: true,
    layout_mode: layoutMode,
    default_type: defaultType,
    default_cover_id: defaultItem ? defaultItem.id : null,
    portrait_charge: portraitCharge,
    price,
    items,
  };
}

/** Текстовые поля обложки + портрет ребёнка (для портретных превью). */
async function buildPreviewData(
  supabase: SupabaseClient,
  a: Record<string, unknown>,
  childId: string | null,
): Promise<Record<string, string | null>> {
  const year =
    a.year != null
      ? String(a.year)
      : albumYear((a.deadline as string | null) ?? null, (a.created_at as string | null) ?? null);
  const classes = Array.isArray(a.classes) ? (a.classes as string[]).join(', ') : null;

  const data: Record<string, string | null> = {
    cover_school_name: (a.school_name as string | null) ?? null,
    cover_city: (a.city as string | null) ?? null,
    cover_year: year,
    cover_title: (a.title as string | null) ?? null,
  };

  if (childId) {
    const { data: child } = await supabase
      .from('children')
      .select('full_name, class')
      .eq('id', childId)
      .maybeSingle();
    if (child) {
      data.cover_student_name = (child as { full_name?: string }).full_name ?? null;
      data.cover_class = (child as { class?: string }).class ?? classes;
    }
    // Портрет страницы ребёнка — показать на портретной обложке.
    const { data: sel } = await supabase
      .from('selections')
      .select('photos(storage_path)')
      .eq('child_id', childId)
      .eq('selection_type', 'portrait_page')
      .maybeSingle();
    const sp = (sel as { photos?: { storage_path?: string } } | null)?.photos?.storage_path;
    if (sp) data.cover_portrait = await getPhotoUrl(sp);
  } else {
    data.cover_class = classes;
  }

  return data;
}

/** Копия данных без фото-полей — для не-портретных превью (заглушки фото). */
function textOnly(data: Record<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'cover_portrait') continue;
    out[k] = v;
  }
  return out;
}

function albumYear(deadline: string | null, createdAt: string | null): string | null {
  const src = deadline ?? createdAt;
  if (!src) return null;
  const y = new Date(src).getFullYear();
  return Number.isFinite(y) ? String(y) : null;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : 0;
  return Number.isFinite(n) ? n : 0;
}
