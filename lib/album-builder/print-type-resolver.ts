/**
 * РЭ.27.3: resolvePrintType — чистая функция определения типа
 * переплёта альбома.
 *
 * Выделена в отдельный модуль (без зависимости от Supabase), чтобы
 * unit-тестировать без env-переменных — паттерн как с
 * filter-by-purchase из РЭ.25.3.
 *
 * Семантика:
 * - albums.print_type приоритетнее, если задан (партнёр явно выбрал
 *   тип листов в альбоме).
 * - preset.print_type fallback (для альбомов до миграции 27.7
 *   или для пресетов без явного типа в альбоме).
 * - 'layflat' финальный default (если оба null/undefined — большинство
 *   исторических альбомов и пресетов layflat).
 *
 * Bridge с двумя форматами:
 * - Старый движок (build-from-preset) использует PrintType =
 *   'layflat' | 'soft'.
 * - Новый движок (buildFromSectionStructure) использует sheet_type =
 *   'hard' | 'soft'. Это синонимы (layflat ≡ hard).
 *
 * Вспомогательная функция printTypeToSheetType конвертирует один
 * в другой, чтобы caller мог переопределить оба поля в bundle.
 *
 * Использование (см. подэтап 27.3 интеграция в layout API):
 *
 *   const effective = resolvePrintType(album.print_type, preset.print_type);
 *   bundle.preset.print_type = effective;
 *   bundle.preset.sheet_type = printTypeToSheetType(effective);
 *   const layout = buildFromSectionStructure(bundle, input);
 */

import type { PrintType } from '@/lib/album-builder/types';

/** Тип переплёта в формате нового движка (rule engine v3). */
export type SheetType = 'hard' | 'soft';

/**
 * Определяет тип переплёта альбома с приоритетом:
 *   1. albumPrintType (явно задан в альбоме)
 *   2. presetPrintType (fallback на пресет)
 *   3. 'layflat' (финальный default)
 *
 * Все аргументы опциональны (могут быть undefined / null) для
 * бэк-совместимости с фикстурами и не полностью мигрированными данными.
 */
export function resolvePrintType(
  albumPrintType: PrintType | null | undefined,
  presetPrintType: PrintType | null | undefined,
): PrintType {
  if (albumPrintType === 'layflat' || albumPrintType === 'soft') {
    return albumPrintType;
  }
  if (presetPrintType === 'layflat' || presetPrintType === 'soft') {
    return presetPrintType;
  }
  return 'layflat';
}

/**
 * Конвертирует PrintType (старый формат) в SheetType (новый формат).
 *   layflat → hard
 *   soft    → soft
 *
 * Нужно для случаев когда caller хочет обновить bundle.preset.sheet_type
 * одновременно с bundle.preset.print_type — оба используются разными
 * частями кода.
 */
export function printTypeToSheetType(printType: PrintType): SheetType {
  return printType === 'soft' ? 'soft' : 'hard';
}

/**
 * Обратная конвертация SheetType → PrintType.
 *   hard → layflat
 *   soft → soft
 *
 * Симметрична printTypeToSheetType. Полезна когда из пресета пришёл
 * только sheet_type, а нужен PrintType для старого движка.
 */
export function sheetTypeToPrintType(sheetType: SheetType): PrintType {
  return sheetType === 'soft' ? 'soft' : 'layflat';
}
