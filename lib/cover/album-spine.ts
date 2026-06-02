/**
 * Расчёт ширины корешка для КОНКРЕТНОГО собранного альбома — Этап 3
 * (ТЗ docs/tz-cover-design.md).
 *
 * Связывает чистую формулу корешка (./spine.ts) с реальным числом листов
 * альбома. По ТЗ: «sheet_count — количество ЛИСТОВ (физических, = разворотов
 * в layflat)». Число разворотов берём из той же сегментации страниц, что и
 * редактор/превью (segmentToSpreads), чтобы корешок совпадал с тем, что видит
 * пользователь.
 *
 * Числа печати (толщина листа, запас) приходят из пресета (PrintSpec,
 * config_presets.print_spec) — параметрические, реальные подставит Сергей.
 */

import { segmentToSpreads } from '../album-builder/segment-to-spreads';
import type { SpreadInstance, SpreadTemplate } from '../album-builder/types';
import { computeSpineWidthFromPreset } from './spine';
import type { PrintSpec } from './types';

/**
 * Число физических листов альбома = число визуальных разворотов (layflat).
 *
 * spreads — legacy-массив страниц (1 элемент = 1 страница), как в
 * album_layouts.spreads. templatesById нужен, чтобы понять is_spread
 * (spread-мастер занимает оба места разворота = один лист).
 *
 * Обложка СЮДА не входит — она отдельная сущность, не лист блока.
 */
export function countAlbumSheets(
  spreads: SpreadInstance[],
  templatesById: ReadonlyMap<string, SpreadTemplate>,
): number {
  return segmentToSpreads(spreads, templatesById).length;
}

/**
 * Ширина корешка собранного альбома: число листов × толщина листа + запас.
 * Тип листа (без прослойки / +0.4 / +0.7) и base_offset берутся из пресета.
 */
export function computeAlbumSpineWidthMm(
  spreads: SpreadInstance[],
  templatesById: ReadonlyMap<string, SpreadTemplate>,
  spec: PrintSpec,
  sheetTypeId?: string | null,
): number {
  const sheetCount = countAlbumSheets(spreads, templatesById);
  return computeSpineWidthFromPreset(spec, sheetCount, sheetTypeId);
}

/**
 * Null-безопасная обёртка для вызова из API/рендера: если у альбома не задан
 * пресет печати (printSpec=null) — корешок посчитать нельзя, возвращаем null
 * (UI покажет «задайте пресет печати»), а не падаем.
 */
export function resolveAlbumSpineWidthMm(
  spreads: SpreadInstance[],
  templatesById: ReadonlyMap<string, SpreadTemplate>,
  printSpec: PrintSpec | null,
  sheetTypeId?: string | null,
): number | null {
  if (!printSpec) return null;
  return computeAlbumSpineWidthMm(spreads, templatesById, printSpec, sheetTypeId);
}
