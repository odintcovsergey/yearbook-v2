/**
 * Сводка обложек заказа (ТЗ tz-cover-summary). Чистая агрегация: кто что выбрал,
 * сколько обложек пойдёт в печать (с дедупликацией общей/дизайна), предупреждения.
 * Только чтение — родительский флоу/cover_choices не меняются.
 *
 * Учительскую обложку пока НЕ считаем (нет явного признака у заказа) — решение
 * Сергея 18.06.2026; вернёмся в ТЗ редактора обложек.
 */

import type { CoverLayoutMode, CoverType } from './types';

export type CoverSummaryStudentInput = {
  child_id: string;
  full_name: string;
  /** Выбор родителя (строка cover_choices) или null, если не выбирал. */
  choice: {
    cover_type: CoverType | null;
    photo_option: 'same' | 'other' | null;
    paid: boolean;
  } | null;
  /** Миниатюра портрета, выбранного для обложки (selections.portrait_cover). */
  cover_portrait_url: string | null;
};

export type CoverSummaryInput = {
  mode: CoverLayoutMode | null;
  default_type: CoverType | null;
  students: CoverSummaryStudentInput[];
  /** Есть ли у класса хотя бы одно общее фото (photos.type='common_full'). */
  common_photo_available: boolean;
};

export type CoverSummaryRow = {
  child_id: string;
  full_name: string;
  cover_type: CoverType | null;
  photo_option: 'same' | 'other' | null;
  cover_portrait_url: string | null;
  paid: boolean;
  status: 'ok' | 'no_choice' | 'needs_photo';
};

export type CoverSummary = {
  /** Сколько учеников по типам + не выбрали. */
  counts: { portrait: number; common: number; design: number; none: number; total: number };
  /** Сколько обложек пойдёт в печать (дедупликация общей/дизайна). */
  print: { portrait: number; common: number; design: number; total: number };
  rows: CoverSummaryRow[];
  warnings: string[];
};

export function buildCoverSummary(input: CoverSummaryInput): CoverSummary {
  const { mode, default_type, students, common_photo_available } = input;
  const fixed = mode === 'fixed';

  const counts = { portrait: 0, common: 0, design: 0, none: 0, total: students.length };
  const rows: CoverSummaryRow[] = [];

  for (const s of students) {
    // В fixed-режиме родитель не выбирает — у всех дефолтный тип.
    const chosen = fixed ? true : !!s.choice;
    const type: CoverType | null = fixed ? default_type : (s.choice?.cover_type ?? null);
    const photo_option = s.choice?.photo_option ?? null;
    const paid = s.choice?.paid ?? false;

    if (!chosen || !type) counts.none++;
    else if (type === 'portrait_photo') counts.portrait++;
    else if (type === 'common_photo') counts.common++;
    else if (type === 'design_only') counts.design++;

    let status: CoverSummaryRow['status'] = 'ok';
    if (!chosen || !type) status = 'no_choice';
    else if (type === 'portrait_photo' && photo_option === 'other' && !s.cover_portrait_url) {
      status = 'needs_photo';
    }

    rows.push({
      child_id: s.child_id,
      full_name: s.full_name,
      cover_type: chosen ? type : null,
      photo_option,
      cover_portrait_url: s.cover_portrait_url,
      paid,
      status,
    });
  }

  // Печать: портретные = каждая своя; общая/дизайн дедуплицируются до 1.
  const print = {
    portrait: counts.portrait,
    common: counts.common > 0 ? 1 : 0,
    design: counts.design > 0 ? 1 : 0,
    total: 0,
  };
  print.total = print.portrait + print.common + print.design;

  const warnings: string[] = [];
  if (print.common > 0 && !common_photo_available) {
    warnings.push('Общая обложка выбрана, но у класса нет ни одного общего фото — подставлять нечего.');
  }
  for (const r of rows) {
    if (r.status === 'needs_photo') {
      warnings.push(`${r.full_name}: выбран портрет «другой», но фото не выбрано.`);
    }
  }
  if (counts.none > 0) {
    warnings.push(`Не выбрали обложку: ${counts.none} чел.`);
  }

  return { counts, print, rows, warnings };
}
