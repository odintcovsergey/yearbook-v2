/**
 * Расчёт плавающего корешка и геометрии полотна обложки — Этап 1
 * (ТЗ docs/tz-cover-design.md).
 *
 * Чистые функции, без БД. Все размеры — в миллиметрах.
 *
 * Формула корешка (ключевая механика ТЗ):
 *   spine_width_mm = base_offset + sheet_count × sheet_thickness_mm
 * где sheet_count = число ЛИСТОВ (= разворотов в layflat), которое система знает.
 */

import type { PrintSpec, SheetType } from './types';

export type SpineInput = {
  /** Число физических листов альбома (= количество разворотов в layflat). */
  sheetCount: number;
  /** Полная толщина одного листа (бумага + прослойка), мм. */
  sheetThicknessMm: number;
  /** Конструктивный запас на сгибы корешка, мм. */
  baseOffsetMm: number;
};

/**
 * Ширина корешка от числа листов и типа бумаги.
 * Возвращает мм, не округляет (округление — забота рендера/PDF под dpi).
 *
 * Бросает при отрицательных входных данных (число листов/толщина/запас не
 * бывают < 0) — это явная ошибка конфигурации, лучше упасть, чем тихо
 * посчитать бессмыслицу.
 */
export function computeSpineWidthMm(input: SpineInput): number {
  const { sheetCount, sheetThicknessMm, baseOffsetMm } = input;

  if (sheetCount < 0) {
    throw new Error(`computeSpineWidthMm: sheetCount не может быть < 0 (${sheetCount})`);
  }
  if (sheetThicknessMm < 0) {
    throw new Error(`computeSpineWidthMm: sheetThicknessMm не может быть < 0 (${sheetThicknessMm})`);
  }
  if (baseOffsetMm < 0) {
    throw new Error(`computeSpineWidthMm: baseOffsetMm не может быть < 0 (${baseOffsetMm})`);
  }

  return baseOffsetMm + sheetCount * sheetThicknessMm;
}

/**
 * Достаёт выбранный тип листа из пресета.
 * - sheetTypeId задан → ищем его;
 * - не задан → default_sheet_type_id;
 * - тоже нет → первый в списке.
 * Бросает, если sheet_types пуст или указанный id не найден.
 */
export function resolveSheetType(spec: PrintSpec, sheetTypeId?: string | null): SheetType {
  if (!spec.sheet_types || spec.sheet_types.length === 0) {
    throw new Error('resolveSheetType: в пресете печати нет ни одного sheet_type');
  }

  const wantedId = sheetTypeId ?? spec.default_sheet_type_id ?? null;

  if (wantedId == null) {
    return spec.sheet_types[0];
  }

  const found = spec.sheet_types.find((s) => s.id === wantedId);
  if (!found) {
    throw new Error(`resolveSheetType: тип листа "${wantedId}" не найден в пресете печати`);
  }
  return found;
}

/**
 * Удобная обёртка: ширина корешка прямо из пресета печати.
 * Сама выбирает тип листа (resolveSheetType) и берёт base_offset из PrintSpec.
 */
export function computeSpineWidthFromPreset(
  spec: PrintSpec,
  sheetCount: number,
  sheetTypeId?: string | null,
): number {
  const sheet = resolveSheetType(spec, sheetTypeId);
  return computeSpineWidthMm({
    sheetCount,
    sheetThicknessMm: sheet.thickness_mm,
    baseOffsetMm: spec.spine_base_offset_mm,
  });
}

export type CoverCanvasInput = {
  /** Ширина задней зоны, мм. */
  backWidthMm: number;
  /** Ширина передней зоны, мм. */
  frontWidthMm: number;
  /** Высота полотна (база блока, без bleed/загиба), мм. */
  heightMm: number;
  /** Ширина корешка (из computeSpineWidthMm), мм. */
  spineWidthMm: number;
  /** Загиб на внутреннюю сторону (с каждой стороны), мм. */
  foldMm: number;
  /** Вылет под обрез (с каждой стороны), мм. */
  bleedMm: number;
};

export type CoverCanvasSize = {
  /** Полная ширина полотна с загибами и bleed, мм. */
  fullWidthMm: number;
  /** Полная высота полотна с загибами и bleed, мм. */
  fullHeightMm: number;
  /** Левая граница корешка от левого края bleed, мм (для разметки зон). */
  spineLeftMm: number;
  /** Правая граница корешка от левого края bleed, мм. */
  spineRightMm: number;
};

/**
 * Полная геометрия полотна обложки (ТЗ «Геометрия обложки-полотна»):
 *   полная_ширина = задняя + корешок + передняя + 2×загиб + 2×bleed
 *   высота         = H_блока + 2×загиб + 2×bleed
 *
 * Также возвращает границы зоны корешка (для разметки зад/корешок/перед),
 * отсчитанные от левого края (включая левый загиб+bleed): развёртка идёт
 * СЛЕВА задняя → ПО ЦЕНТРУ корешок → СПРАВА передняя.
 */
export function computeCoverCanvasSize(input: CoverCanvasInput): CoverCanvasSize {
  const { backWidthMm, frontWidthMm, heightMm, spineWidthMm, foldMm, bleedMm } = input;

  for (const [k, v] of Object.entries(input)) {
    if (v < 0) {
      throw new Error(`computeCoverCanvasSize: "${k}" не может быть < 0 (${v})`);
    }
  }

  const sideMargin = foldMm + bleedMm; // загиб + bleed с одной стороны
  const fullWidthMm = backWidthMm + spineWidthMm + frontWidthMm + 2 * sideMargin;
  const fullHeightMm = heightMm + 2 * sideMargin;

  const spineLeftMm = sideMargin + backWidthMm;
  const spineRightMm = spineLeftMm + spineWidthMm;

  return { fullWidthMm, fullHeightMm, spineLeftMm, spineRightMm };
}
