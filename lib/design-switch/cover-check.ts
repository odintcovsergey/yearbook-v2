/**
 * Смена дизайна в редакторе — загрузчик проверки совместимости (Этап 1).
 *
 * Читает сохранённую вёрстку альбома + мастера текущего и нового дизайнов,
 * прогоняет чистую `checkCoverage` (см. compatibility.ts, вариант B — по
 * текущим разворотам). Сети/БД только здесь; логика — в compatibility.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadTemplateSetById } from '@/lib/album-builder/load-template-set';
import type { SpreadTemplate } from '@/lib/album-builder/types';
import { checkCoverage, type CoverageResult, type LayoutSpreadRef } from './compatibility';

type SavedSpread = {
  spread_index?: number;
  template_id?: string;
  section_type?: string | null;
};

/**
 * Проверяет, можно ли перевести альбом на дизайн `targetTemplateSetId` без
 * потери типов разворотов. Возвращает `{ ok, missing, message }`.
 *
 * Граничные случаи (V1):
 *  - нет сохранённой вёрстки / пустые spreads → ok:true (переносить нечего);
 *  - у вёрстки не указан текущий дизайн (template_set_id NULL, старые данные) →
 *    типы проверить нельзя → ok:true, все развороты в unverified (сигнал).
 */
export async function coverCheck(
  supabase: SupabaseClient,
  albumId: string,
  targetTemplateSetId: string,
): Promise<CoverageResult> {
  const { data: layoutRow } = await supabase
    .from('album_layouts')
    .select('spreads, template_set_id')
    .eq('album_id', albumId)
    .maybeSingle();

  const rawSpreads = (layoutRow?.spreads as SavedSpread[] | null) ?? [];
  const currentSpreads: LayoutSpreadRef[] = rawSpreads
    .filter((s) => s && typeof s.template_id === 'string')
    .map((s, i) => ({
      spread_index: typeof s.spread_index === 'number' ? s.spread_index : i,
      template_id: s.template_id as string,
      section_type: s.section_type ?? null,
    }));

  // Нечего переносить — любой дизайн «подходит».
  if (currentSpreads.length === 0) {
    return { ok: true, missing: [], message: null, unverifiedSpreadIndexes: [] };
  }

  // Мастера нового дизайна (для подбора замен).
  const targetSet = await loadTemplateSetById(supabase, targetTemplateSetId);
  const targetMasters: SpreadTemplate[] = targetSet.spreads;

  // Мастера текущего дизайна (по id — чтобы разобрать тип каждого разворота).
  const currentMastersById = new Map<string, SpreadTemplate>();
  const currentTsId = (layoutRow?.template_set_id as string | null) ?? null;
  if (currentTsId) {
    const currentSet = await loadTemplateSetById(supabase, currentTsId);
    for (const m of currentSet.spreads) currentMastersById.set(m.id, m);
  }
  // Если currentTsId NULL — карта пустая → все развороты уйдут в unverified
  // (checkCoverage не сможет определить тип), вернётся ok:true. Это осознанный
  // V1-фолбэк для старых данных без зафиксированного дизайна.

  return checkCoverage(currentSpreads, currentMastersById, targetMasters, targetSet.name);
}
