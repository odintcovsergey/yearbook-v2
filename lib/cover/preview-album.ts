/**
 * Превью собранной обложки на КОНКРЕТНЫЙ альбом — даёт увидеть результат
 * целиком: реальные ФИО/город/год/класс + посчитанный корешок (ТЗ обложки).
 *
 * Связывает loadAlbumCovers (сборка по режиму/выбору) + геометрию мастера из
 * covers + layoutCover (плавающий корешок) + renderCoverPreviewSvg.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Placeholder, RenderPlaceholder } from '../album-builder/types';
import { loadAlbumCovers } from './load-covers';
import { layoutCover } from './layout';
import { renderCoverPreviewSvg } from './preview-svg';
import { indexCoverEdits, mergeCoverEditsInto, resolveCoverBackground, COVER_BG_KEY, type CoverEditRow } from './editor-merge';
import { resolveReadUrl } from '../blob-storage';
import type { CoverType } from './types';

export type AlbumCoverPreview = {
  /** Ученик, чья это обложка. null = общая. */
  child_id: string | null;
  child_name: string | null;
  cover_name: string | null;
  cover_type: CoverType;
  /** Назначена ли обложка (есть подходящий мастер в библиотеке). */
  has_cover: boolean;
  svg: string;
};

export type AlbumCoverPreviewResult = {
  previews: AlbumCoverPreview[];
  /** Ширина корешка (мм) или null (нет пресета печати/layout). */
  spine_width_mm: number | null;
  warnings: string[];
};

export type CoverMasterRow = {
  id: string;
  placeholders: Placeholder[] | null;
  back_width_mm: number | null;
  front_width_mm: number | null;
  height_mm: number | null;
  nominal_spine_width_mm: number | null;
  background_url: string | null;
};

export async function buildAlbumCoverPreviews(
  supabase: SupabaseClient,
  albumId: string,
): Promise<AlbumCoverPreviewResult> {
  const assembled = await loadAlbumCovers(supabase, albumId);

  // Геометрия мастеров (placeholders + зоны) для использованных обложек.
  const coverIds = Array.from(
    new Set(assembled.covers.map((c) => c.cover_id).filter(Boolean)),
  ) as string[];
  const masters = new Map<string, CoverMasterRow>();
  if (coverIds.length > 0) {
    const { data } = await supabase
      .from('covers')
      .select('id, placeholders, back_width_mm, front_width_mm, height_mm, nominal_spine_width_mm, background_url')
      .in('id', coverIds);
    for (const m of (data ?? []) as CoverMasterRow[]) masters.set(m.id, m);
  }

  // Имена учеников для подписи плиток.
  const childIds = assembled.covers.map((c) => c.child_id).filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (childIds.length > 0) {
    const { data } = await supabase.from('children').select('id, full_name').in('id', childIds);
    for (const c of (data ?? []) as Array<{ id: string; full_name: string }>) names.set(c.id, c.full_name);
  }

  // Правки редактора (cover_edits): фон/скрытие/кроп/тексты — чтобы превью
  // заказа совпадало с тем, что менеджер настроил в редакторе обложек.
  const { data: editRows } = await supabase
    .from('cover_edits')
    .select('cover_type, child_id, data')
    .eq('album_id', albumId);
  const { byType, byChild } = indexCoverEdits((editRows ?? []) as CoverEditRow[]);

  const previews: AlbumCoverPreview[] = await Promise.all(
    assembled.covers.map(async (inst) => {
      const master = inst.cover_id ? masters.get(inst.cover_id) ?? null : null;
      const merged = mergeCoverEditsInto(
        { child_id: inst.child_id, cover_type: inst.cover_type, data: inst.data },
        byType,
        byChild,
      );
      return {
        child_id: inst.child_id,
        child_name: inst.child_id ? names.get(inst.child_id) ?? null : null,
        cover_name: inst.cover_name,
        cover_type: inst.cover_type,
        has_cover: !!master,
        svg: master ? await renderCoverMasterSvg(master, assembled.spine_width_mm, merged.data) : '',
      };
    }),
  );

  return { previews, spine_width_mm: assembled.spine_width_mm, warnings: assembled.warnings };
}

/**
 * Рендерит SVG-превью одного cover-мастера (геометрия + плавающий корешок +
 * данные/заглушки). Переиспользуется родительской галереей обложек (Этап 3).
 */
export async function renderCoverMasterSvg(
  m: CoverMasterRow,
  realSpineMm: number | null,
  data: Record<string, string | null>,
): Promise<string> {
  const back = num(m.back_width_mm);
  const front = num(m.front_width_mm);
  let height = num(m.height_mm);
  const nominal = num(m.nominal_spine_width_mm);
  // Реальный корешок из числа листов; если не посчитан — номинальный из макета.
  const real = realSpineMm ?? nominal;

  const placeholders = (Array.isArray(m.placeholders) ? m.placeholders : []) as Array<
    RenderPlaceholder & { zone?: 'back' | 'spine' | 'front' }
  >;
  const laid = layoutCover(
    { backWidthMm: back, frontWidthMm: front, heightMm: height, nominalSpineWidthMm: nominal, realSpineWidthMm: real },
    placeholders,
  );

  let width = laid.width_mm;
  if (width <= 0 || height <= 0) {
    for (const p of placeholders) {
      width = Math.max(width, (p.x_mm ?? 0) + (p.width_mm ?? 0));
      height = Math.max(height, (p.y_mm ?? 0) + (p.height_mm ?? 0));
    }
  }

  // Переезд на Timeweb: эффективный фон (__bg__ перекрывает мастер) подписываем
  // через resolveReadUrl (относительный ключ ИЛИ полный supabase-URL → signed
  // Timeweb-URL). Сырой __bg__ из data убираем, иначе preview-svg вставит
  // относительный ключ в <image href> → битая картинка (ручной фон обложки).
  const effectiveBg = resolveCoverBackground(data, m.background_url);
  const signedBg = effectiveBg
    ? await resolveReadUrl('template-backgrounds', effectiveBg)
    : null;
  const cleanData = { ...data };
  delete cleanData[COVER_BG_KEY];

  return renderCoverPreviewSvg({
    width_mm: width || 100,
    height_mm: height || 100,
    spine_left_mm: laid.spine_left_mm,
    spine_right_mm: laid.spine_right_mm,
    placeholders: laid.placeholders,
    data: cleanData,
    background_url: signedBg,
    // Превью собранной обложки: пустые слоты скрываем (реальный вид), не серые.
    hide_empty_slots: true,
  });
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : 0;
  return Number.isFinite(n) ? n : 0;
}
