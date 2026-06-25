/**
 * Смена дизайна — перенос (remap) разворотов на мастера нового дизайна (Этап 2).
 *
 * ЧИСТАЯ логика (без БД) — для тестов и dry-run. Запись/загрузка — remap-album.ts.
 *
 * Подход: распределение НЕ трогаем. Для КАЖДОГО сохранённого разворота берём его
 * текущий мастер (по template_id), подбираем мастер нового дизайна
 * (`findReplacementMaster` из Этапа 1) и переносим контент по label'ам через
 * `remapData`. Переносим ТОЛЬКО кропы; стили/рамки/фоны/расположение слотов
 * берутся из нового дизайна; балансировка старого мастера отбрасывается.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import { remapData, type RemapStats } from '@/lib/template-replace';
import { findReplacementMaster } from './compatibility';

/**
 * Что переносим из старого разворота на новый при СМЕНЕ ДИЗАЙНА. ОСОЗНАННЫЙ
 * список (см. ТЗ docs/tz-design-switch.md):
 *  - `__scale__/__offset__/__rotate__` — кропы (ручная подрезка фото): переносим;
 *  - `__hidden__` — скрытие слота. Это про «есть/нет контента» (учеников/
 *    учителей столько же), а не про геометрию → СОХРАНЯЕМ, иначе пустые слоты,
 *    которые были скрыты, вылезут после смены дизайна.
 *
 * НЕ переносим (берётся из нового дизайна / привязано к старому мастеру):
 *  - стили `__fontSize__/__color__/__font__/__halign__/__valign__` — оформление
 *    берётся из нового дизайна (решение владельца);
 *  - `__pos__` — ручное смещение рамки привязано к координатам СТАРОГО мастера,
 *    на новом бессмысленно.
 *
 * Граничный случай (V1, приемлем): если у нового мастера больше слотов, лишние
 * новые пустые слоты скрытия не получат (их `__hidden__` в старых данных не было).
 */
export const DESIGN_SWITCH_CARRY_PREFIXES = ['__scale__', '__offset__', '__rotate__', '__hidden__'] as const;

/** Минимум сохранённого разворота, нужный для переноса. */
export interface SavedSpread {
  spread_index: number;
  template_id: string;
  template_name?: string;
  data: Record<string, string | null>;
  section_type?: string | null;
  [k: string]: unknown;
}

export type SpreadRemapStatus = 'remapped' | 'unverified' | 'unmappable';

export interface SpreadRemapInfo {
  spread_index: number;
  status: SpreadRemapStatus;
  /** Имя текущего мастера (если известен). */
  fromMaster: string | null;
  /** Имя мастера нового дизайна (если подобран). */
  toMaster: string | null;
  /** Статистика переноса (только для status='remapped'). */
  stats: RemapStats | null;
}

export interface RemapSpreadsResult {
  /** Новые развороты (для записи). Те же по числу/порядку, что и входные. */
  newSpreads: SavedSpread[];
  /** Подробности по каждому развороту (для dry-run/диагностики). */
  perSpread: SpreadRemapInfo[];
  /** Развороты, для которых не нашлось мастера нового дизайна (coverCheck должен
   *  был это поймать раньше). Непустой список = что-то не так, не писать. */
  unmappable: number[];
}

/**
 * Переносит развороты альбома на мастера нового дизайна. Распределение и порядок
 * сохраняются. Развороты, чей текущий мастер неизвестен (битые данные), остаются
 * как есть и помечаются 'unverified'.
 */
export function remapAlbumSpreads(
  currentSpreads: SavedSpread[],
  currentMastersById: ReadonlyMap<string, SpreadTemplate>,
  targetMasters: readonly SpreadTemplate[],
): RemapSpreadsResult {
  const newSpreads: SavedSpread[] = [];
  const perSpread: SpreadRemapInfo[] = [];
  const unmappable: number[] = [];

  for (const sp of currentSpreads) {
    const cur = currentMastersById.get(sp.template_id);
    if (!cur) {
      newSpreads.push(sp); // оставляем как есть
      perSpread.push({ spread_index: sp.spread_index, status: 'unverified', fromMaster: null, toMaster: null, stats: null });
      continue;
    }
    const tgt = findReplacementMaster(cur, targetMasters);
    if (!tgt) {
      unmappable.push(sp.spread_index);
      newSpreads.push(sp); // не трогаем
      perSpread.push({ spread_index: sp.spread_index, status: 'unmappable', fromMaster: cur.name, toMaster: null, stats: null });
      continue;
    }
    const { newData, stats } = remapData(
      sp.data ?? {},
      cur.placeholders,
      tgt.placeholders,
      DESIGN_SWITCH_CARRY_PREFIXES,
    );
    newSpreads.push({ ...sp, template_id: tgt.id, template_name: tgt.name, data: newData });
    perSpread.push({ spread_index: sp.spread_index, status: 'remapped', fromMaster: cur.name, toMaster: tgt.name, stats });
  }

  return { newSpreads, perSpread, unmappable };
}
