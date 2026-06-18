import { describe, it, expect } from 'vitest';
import { buildCoverSummary, type CoverSummaryInput } from '../summary';

function student(id: string, choice: CoverSummaryInput['students'][number]['choice'], portraitUrl: string | null = null) {
  return { child_id: id, full_name: `Ученик ${id}`, choice, cover_portrait_url: portraitUrl };
}

describe('buildCoverSummary', () => {
  it('агрегаты и число обложек на печать (дедупликация общей/дизайна)', () => {
    const students = [
      ...Array.from({ length: 10 }, (_, i) =>
        student(`p${i}`, { cover_type: 'portrait_photo', photo_option: 'same', paid: false })),
      student('c1', { cover_type: 'common_photo', photo_option: null, paid: false }),
      student('c2', { cover_type: 'common_photo', photo_option: null, paid: false }),
      student('d1', { cover_type: 'design_only', photo_option: null, paid: false }),
    ];
    const r = buildCoverSummary({ mode: 'default_editable', default_type: 'portrait_photo', students, common_photo_available: true });
    expect(r.counts).toMatchObject({ portrait: 10, common: 2, design: 1, none: 0, total: 13 });
    // печать: 10 портретных (каждая своя) + 1 общая + 1 дизайн = 12
    expect(r.print).toMatchObject({ portrait: 10, common: 1, design: 1, total: 12 });
  });

  it('не выбравшие считаются в none + предупреждение', () => {
    const students = [
      student('a', { cover_type: 'portrait_photo', photo_option: 'same', paid: false }),
      student('b', null),
      student('c', null),
    ];
    const r = buildCoverSummary({ mode: 'default_editable', default_type: 'portrait_photo', students, common_photo_available: true });
    expect(r.counts.none).toBe(2);
    expect(r.print.portrait).toBe(1);
    expect(r.warnings.some(w => /Не выбрали обложку: 2/.test(w))).toBe(true);
    expect(r.rows.find(x => x.child_id === 'b')?.status).toBe('no_choice');
  });

  it('портрет «другой» без фото → needs_photo + предупреждение', () => {
    const students = [
      student('a', { cover_type: 'portrait_photo', photo_option: 'other', paid: true }, null),
      student('b', { cover_type: 'portrait_photo', photo_option: 'other', paid: true }, 'https://cdn/x.jpg'),
    ];
    const r = buildCoverSummary({ mode: 'default_editable', default_type: 'portrait_photo', students, common_photo_available: true });
    expect(r.rows.find(x => x.child_id === 'a')?.status).toBe('needs_photo');
    expect(r.rows.find(x => x.child_id === 'b')?.status).toBe('ok');
    expect(r.warnings.some(w => /Ученик a.*фото не выбрано/.test(w))).toBe(true);
  });

  it('общая выбрана, общего фото нет → предупреждение', () => {
    const students = [student('c', { cover_type: 'common_photo', photo_option: null, paid: false })];
    const r = buildCoverSummary({ mode: 'default_editable', default_type: 'common_photo', students, common_photo_available: false });
    expect(r.warnings.some(w => /нет ни одного общего фото/.test(w))).toBe(true);
  });

  it('общая выбрана, общее фото есть → без предупреждения о фото', () => {
    const students = [student('c', { cover_type: 'common_photo', photo_option: null, paid: false })];
    const r = buildCoverSummary({ mode: 'default_editable', default_type: 'common_photo', students, common_photo_available: true });
    expect(r.warnings.some(w => /общего фото/.test(w))).toBe(false);
  });

  it('fixed-режим: родитель не выбирает, все считаются дефолтным типом', () => {
    const students = [student('a', null), student('b', null)];
    const r = buildCoverSummary({ mode: 'fixed', default_type: 'design_only', students, common_photo_available: true });
    expect(r.counts.design).toBe(2);
    expect(r.counts.none).toBe(0);
    expect(r.print).toMatchObject({ design: 1, portrait: 0, total: 1 });
  });
});
