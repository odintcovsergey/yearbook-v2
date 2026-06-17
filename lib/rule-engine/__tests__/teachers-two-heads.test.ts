/**
 * Часть 2 (ТЗ 17.06.2026): ДВА равных главных (классруков / воспитателей)
 * через полный движок buildFromSectionStructure.
 *
 * Проверяем подбор мастера по числу главных:
 *  - набор с head_teacher:2 (детсад) + два главных → мастер выбран, оба слота
 *    заполнены;
 *  - набор с head_teacher:2 + один главный → мастер всё равно выбран
 *    (фолбэк headTeacher 1↔2), слот _2 скрыт;
 *  - набор с head_teacher:1 (школа) + два главных → мастер выбран (фолбэк),
 *    warning head_teachers_overflow, показан только первый.
 */
import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, RulesAlbumInput, RulesHeadTeacherInput } from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  Placeholder,
  SlotCapacity,
  PageRole,
  SpreadTemplate,
  TemplateSet,
} from '@/lib/album-builder/types';

function photoSlot(label: string): Placeholder {
  return { label, x_mm: 0, y_mm: 0, width_mm: 40, height_mm: 55, type: 'photo', fit: 'fill_proportional', required: false };
}
function textSlot(label: string): Placeholder {
  return { label, x_mm: 0, y_mm: 0, width_mm: 40, height_mm: 10, type: 'text', font_family: 'Arial', font_size_pt: 10, font_weight: 'regular', color: '#000', align: 'left', vertical_align: 'top', auto_fit: false };
}

/** Левый F-Head-* мастер на `heads` главных (нумерованные слоты), 0 предметников. */
function makeHeadMaster(name: string, heads: number): SpreadTemplate {
  const placeholders: Placeholder[] = [];
  for (let i = 1; i <= heads; i++) {
    placeholders.push(photoSlot(`headteacherphoto_${i}`));
    placeholders.push(textSlot(`headteachername_${i}`));
    placeholders.push(textSlot(`headteacherrole_${i}`));
  }
  placeholders.push(textSlot('headtextframe'));
  return {
    id: `id-${name}`, name, type: 'head_teacher', is_spread: false, width_mm: 200, height_mm: 280,
    placeholders, rules: null, sort_order: 0, applies_to_configs: [], default_for_configs: [],
    page_role: 'teacher_left' as PageRole,
    slot_capacity: { head_teacher: heads, teachers: 0, photos_full: 0 } as SlotCapacity,
    is_fallback: false, mirror_for_soft: false, audit_notes: null,
  };
}

function makePreset(id: string): Preset {
  return {
    id, display_name: 'Test', print_type: 'layflat', pages_per_spread: 2, version: '1.0',
    sections: [], tenant_id: null, section_structure: [{ type: 'teachers' }],
    density: null, sheet_type: null, student_layout_mode: null, student_grid_size: null,
    student_friend_photos: null, student_has_quote: null, student_pages_per_student: null,
  };
}

function makeBundle(masters: SpreadTemplate[]): RuleEngineBundle {
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of masters) mastersByName.set(m.name, m);
  const templateSet: TemplateSet = {
    id: 'ts', tenant_id: null, name: 't', slug: 't', print_type: 'layflat',
    page_width_mm: 200, page_height_mm: 280, spread_width_mm: 400, spread_height_mm: 280,
    bleed_mm: 0, facing_pages: true, page_binding: 'LeftToRight', spreads: masters,
  };
  return { preset: makePreset('p'), rules: [], families: [], templateSet, mastersByName };
}

const HEAD1: RulesHeadTeacherInput = { photo: 'https://cdn/h1.jpg', name: 'Беляева', role: 'Воспитатель', text: 'Общее письмо' };
const HEAD2: RulesHeadTeacherInput = { photo: 'https://cdn/h2.jpg', name: 'Соколова', role: 'Воспитатель', text: '' };

function makeInput(heads: RulesHeadTeacherInput[]): RulesAlbumInput {
  return {
    students: [], subjects: [],
    head_teacher: heads[0] ?? { photo: null, name: '', role: '', text: '' },
    head_teachers: heads,
    common_photos: { full_class: [], half_class: [], spread: [], quarter: [], sixth: [], collage: [] },
  };
}

describe('Два равных главных через движок (Часть 2)', () => {
  it('набор head_teacher:2 + два главных → мастер выбран, оба слота заполнены', () => {
    const bundle = makeBundle([makeHeadMaster('F-Head-Two', 2)]);
    const result = buildFromSectionStructure(bundle, makeInput([HEAD1, HEAD2]));
    const left = result.spreads[0].left!;
    expect(left.master_id).toBe('id-F-Head-Two');
    expect(left.bindings.headteacherphoto_1).toBe('https://cdn/h1.jpg');
    expect(left.bindings.headteacherphoto_2).toBe('https://cdn/h2.jpg');
    expect(left.bindings.headteachername_2).toBe('Соколова');
    expect(left.bindings.__hidden__headteacherphoto_2).toBeUndefined();
    expect(left.bindings.headtextframe).toBe('Общее письмо');
    expect(
      result.warnings.some((w) => w.startsWith('head_teachers_overflow')),
    ).toBe(false);
  });

  it('набор head_teacher:2 + один главный → мастер выбран (фолбэк), _2 скрыт', () => {
    const bundle = makeBundle([makeHeadMaster('F-Head-Two', 2)]);
    const result = buildFromSectionStructure(bundle, makeInput([HEAD1]));
    const left = result.spreads[0].left!;
    expect(left.master_id).toBe('id-F-Head-Two');
    expect(left.bindings.headteacherphoto_1).toBe('https://cdn/h1.jpg');
    expect(left.bindings.__hidden__headteacherphoto_2).toBe('1');
    expect(left.bindings.__hidden__headteachername_2).toBe('1');
  });

  it('набор head_teacher:1 (школа) + два главных → фолбэк + warning overflow', () => {
    const bundle = makeBundle([makeHeadMaster('F-Head-One', 1)]);
    const result = buildFromSectionStructure(bundle, makeInput([HEAD1, HEAD2]));
    const left = result.spreads[0].left!;
    expect(left.master_id).toBe('id-F-Head-One');
    expect(left.bindings.headteacherphoto_1).toBe('https://cdn/h1.jpg');
    expect(
      result.warnings.some((w) => w.startsWith('head_teachers_overflow')),
    ).toBe(true);
  });
});
