/**
 * Смена дизайна — применение к альбому (Этап 2, загрузчик).
 *
 * Грузит вёрстку + мастера двух дизайнов, проверяет совместимость (coverCheck),
 * переносит развороты на новый дизайн (remapAlbumSpreads) и — по флагу `write` —
 * пишет результат. БЕЗ `write` это DRY-RUN: ничего не меняем, возвращаем что
 * получилось бы (для предпросмотра/диагностики).
 *
 * Запись (write=true):
 *  - album_layouts.spreads = новые развороты, template_set_id = новый;
 *    has_user_edits НЕ трогаем (это не пересборка — правки остаются);
 *  - albums.template_set_id = новый (чтобы экспорт/пересборка шли на новом дизайне).
 *
 * Фото переносятся КАК ЕСТЬ (V1): remap значения не меняет, новой протухаемости
 * не вносит. Пере-подпись album_layouts — отдельный долг (бэклог).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadTemplateSetById } from '@/lib/album-builder/load-template-set';
import type { SpreadTemplate } from '@/lib/album-builder/types';
import { coverCheck } from './cover-check';
import { remapAlbumSpreads, type SavedSpread, type SpreadRemapInfo } from './remap';
import type { CoverageResult } from './compatibility';

export interface RemapAlbumResult {
  ok: boolean;
  /** Применена ли запись (false при dry-run или отказе). */
  written: boolean;
  /** Текст отказа, если несовместимо (из coverCheck) или внутренняя ошибка. */
  message: string | null;
  /** Результат проверки совместимости. */
  coverage: CoverageResult;
  /** Подробности по каждому развороту (для предпросмотра). */
  perSpread: SpreadRemapInfo[];
  /** Новые развороты (для предпросмотра/diff). */
  newSpreads: SavedSpread[];
}

export async function remapAlbumToDesign(
  supabase: SupabaseClient,
  albumId: string,
  targetTemplateSetId: string,
  opts: { write?: boolean } = {},
): Promise<RemapAlbumResult> {
  // 1. Guard: совместимость. Несовместимо → не трогаем ничего.
  const coverage = await coverCheck(supabase, albumId, targetTemplateSetId);
  if (!coverage.ok) {
    return { ok: false, written: false, message: coverage.message, coverage, perSpread: [], newSpreads: [] };
  }

  // 2. Грузим вёрстку.
  const { data: layoutRow } = await supabase
    .from('album_layouts')
    .select('spreads, template_set_id')
    .eq('album_id', albumId)
    .maybeSingle();

  const rawSpreads = (layoutRow?.spreads as SavedSpread[] | null) ?? [];
  const currentSpreads: SavedSpread[] = rawSpreads
    .filter((s) => s && typeof s.template_id === 'string')
    .map((s, i) => ({ ...s, spread_index: typeof s.spread_index === 'number' ? s.spread_index : i }));

  // Нечего переносить — но дизайн альбома всё равно проставим (по флагу).
  if (currentSpreads.length === 0) {
    if (opts.write) {
      await supabase.from('albums').update({ template_set_id: targetTemplateSetId }).eq('id', albumId);
    }
    return { ok: true, written: !!opts.write, message: null, coverage, perSpread: [], newSpreads: [] };
  }

  // 3. Мастера обоих дизайнов.
  const targetSet = await loadTemplateSetById(supabase, targetTemplateSetId);
  const targetMasters: SpreadTemplate[] = targetSet.spreads;

  const currentMastersById = new Map<string, SpreadTemplate>();
  const currentTsId = (layoutRow?.template_set_id as string | null) ?? null;
  if (currentTsId) {
    const currentSet = await loadTemplateSetById(supabase, currentTsId);
    for (const m of currentSet.spreads) currentMastersById.set(m.id, m);
  }

  // 4. Перенос (чистая логика).
  const { newSpreads, perSpread, unmappable } = remapAlbumSpreads(
    currentSpreads,
    currentMastersById,
    targetMasters,
  );

  // coverCheck прошёл, но мастер не подобрался — несогласованность, не пишем.
  if (unmappable.length > 0) {
    return {
      ok: false,
      written: false,
      message:
        'Внутренняя несогласованность: проверка совместимости прошла, но для ' +
        `${unmappable.length} разворот(ов) не нашлось страницы в новом дизайне. Запись отменена.`,
      coverage,
      perSpread,
      newSpreads,
    };
  }

  // 5. Запись (только по флагу).
  if (opts.write) {
    const { error: e1 } = await supabase
      .from('album_layouts')
      .update({
        spreads: newSpreads,
        template_set_id: targetTemplateSetId,
        updated_at: new Date().toISOString(),
        // has_user_edits НЕ трогаем — правки сохраняются (это не пересборка).
      })
      .eq('album_id', albumId);
    if (e1) {
      return { ok: false, written: false, message: `Ошибка записи вёрстки: ${e1.message}`, coverage, perSpread, newSpreads };
    }
    const { error: e2 } = await supabase
      .from('albums')
      .update({ template_set_id: targetTemplateSetId })
      .eq('id', albumId);
    if (e2) {
      return { ok: false, written: false, message: `Вёрстка обновлена, но дизайн альбома не записан: ${e2.message}`, coverage, perSpread, newSpreads };
    }
  }

  return { ok: true, written: !!opts.write, message: null, coverage, perSpread, newSpreads };
}
