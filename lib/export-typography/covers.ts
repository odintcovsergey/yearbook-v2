/**
 * Сборка ФАЙЛОВ обложек для типографской выгрузки (ТЗ экспорта §3).
 *
 * Берёт собранные обложки альбома (loadAlbumCovers) + геометрию мастеров +
 * правки редактора (cover_edits) и готовит «единицы рендера» обложек:
 *   - layoutCover — раздвигает полотно под реальный корешок;
 *   - adaptCoverToFormat — адаптирует под формат заказа (корешок физический);
 *   - дедупликация: портретные обложки — по людям (файл 00X-00), общая/дизайн —
 *     ОДИН файл 000-00 (из сводки lib/cover/summary).
 *
 * Имя 00X = номер ученика (childNumber), согласованный с внутренними книгами.
 * Чистая функция — рендер (pdf-lib) отдельно (pipeline.renderCoverUnits).
 */

import type { Placeholder, RenderPlaceholder } from '../album-builder/types';
import type { FormatFamily, PrinterFormat } from '../printers/types';
import { adaptCoverToFormat } from '../format-adapt';
import { layoutCover } from '../cover/layout';
import {
  mergeCoverEditsInto,
  resolveCoverBackground,
} from '../cover/editor-merge';
import type { CoverInstance } from '../cover/assemble';
import { COMMON_BOOK_ID, formatBookId, bookFileName } from '../album-split';

/** Геометрия мастера обложки (проекция строки covers). */
export type CoverMasterGeometry = {
  id: string;
  placeholders: Placeholder[] | null;
  back_width_mm: number | null;
  front_width_mm: number | null;
  height_mm: number | null;
  nominal_spine_width_mm: number | null;
  background_url: string | null;
};

/** Готовая единица рендера обложки = один файл выгрузки. */
export type CoverRenderUnit = {
  /** Имя файла без расширения: "000-00" (общая) / "00X-00" (личная). */
  file_name: string;
  /** Полная ширина/высота полотна обложки (мм) после layout+adapt. */
  width_mm: number;
  height_mm: number;
  /** Плейсхолдеры (абсолютные координаты по всему полотну). */
  placeholders: Placeholder[];
  /** Данные (метка → значение), уже с правками редактора. */
  data: Record<string, string | null>;
  /** Эффективный фон обложки (URL) или null. */
  background_url: string | null;
};

export type BuildCoverUnitsInput = {
  covers: CoverInstance[];
  /** Геометрия мастеров по id. */
  masters: Map<string, CoverMasterGeometry>;
  /** Правки редактора, разложенные indexCoverEdits. */
  editsByType: Record<string, Record<string, string | null>>;
  editsByChild: Record<string, Record<string, string | null>>;
  /** Реальная ширина корешка (мм) или null → номинальная из мастера. */
  spineWidthMm: number | null;
  /** Семейство дизайна (для adaptCoverToFormat). */
  family: FormatFamily;
  /** Формат заказа или null (родной). */
  targetFormat: PrinterFormat | null;
  /** child_id → номер ученика (1-based), согласован с внутренними книгами 00X. */
  childNumber: Map<string, number>;
};

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Готовит единицы рендера обложек с дедупликацией и именами.
 *  - portrait_photo → файл на ученика, имя 00X-00 (X = childNumber);
 *  - common_photo / design_only → ОДИН файл 000-00 (первый встреченный).
 * Обложки без мастера/без номера ученика пропускаются (в warnings — снаружи).
 */
export function buildCoverRenderUnits(input: BuildCoverUnitsInput): {
  units: CoverRenderUnit[];
  skipped: string[];
} {
  const units: CoverRenderUnit[] = [];
  const skipped: string[] = [];
  let commonDone = false;

  for (const inst of input.covers) {
    const master = inst.cover_id ? input.masters.get(inst.cover_id) ?? null : null;
    if (!master) {
      skipped.push(`нет мастера обложки (${inst.cover_type}, ученик ${inst.child_id ?? '—'})`);
      continue;
    }

    // Имя файла + дедуп.
    let fileName: string;
    if (inst.cover_type === 'portrait_photo') {
      if (!inst.child_id) {
        skipped.push('портретная обложка без ученика — пропущена');
        continue;
      }
      const n = input.childNumber.get(inst.child_id);
      if (n === undefined) {
        skipped.push(`нет номера ученика для обложки (child ${inst.child_id})`);
        continue;
      }
      fileName = bookFileName(formatBookId(n), 0); // 00X-00
    } else {
      // common_photo / design_only — одна общая обложка 000-00.
      if (commonDone) continue; // дедуп: остальные общие пропускаем
      commonDone = true;
      fileName = bookFileName(COMMON_BOOK_ID, 0); // 000-00
    }

    // Правки редактора → данные.
    const merged = mergeCoverEditsInto(
      { child_id: inst.child_id, cover_type: inst.cover_type, data: inst.data },
      input.editsByType,
      input.editsByChild,
    );

    // Геометрия: layoutCover (плавающий корешок) → adaptCoverToFormat.
    const back = num(master.back_width_mm);
    const front = num(master.front_width_mm);
    const height = num(master.height_mm);
    const nominal = num(master.nominal_spine_width_mm);
    const real = input.spineWidthMm ?? nominal;
    const masterPlaceholders = (Array.isArray(master.placeholders)
      ? master.placeholders
      : []) as Array<RenderPlaceholder & { zone?: 'back' | 'spine' | 'front' }>;

    const laid = layoutCover(
      {
        backWidthMm: back,
        frontWidthMm: front,
        heightMm: height,
        nominalSpineWidthMm: nominal,
        realSpineWidthMm: real,
      },
      masterPlaceholders,
    );

    const adapted = adaptCoverToFormat(
      {
        backWidthMm: back,
        frontWidthMm: front,
        heightMm: height,
        spineWidthMm: real,
        family: input.family,
        placeholders: laid.placeholders,
      },
      input.targetFormat,
    );

    units.push({
      file_name: fileName,
      width_mm: adapted.widthMm || laid.width_mm || 100,
      height_mm: adapted.heightMm || height || 100,
      placeholders: adapted.placeholders as unknown as Placeholder[],
      data: merged.data,
      background_url: resolveCoverBackground(merged.data, master.background_url),
    });
  }

  return { units, skipped };
}
