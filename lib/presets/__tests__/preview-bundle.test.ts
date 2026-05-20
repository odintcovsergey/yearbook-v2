/**
 * Тесты для buildPresetPreviewBundle (РЭ.24.3).
 *
 * Покрывают:
 *  - Полный пресет (students/teachers/cover/soft) → все 4 SVG
 *  - Пресет без cover-мастера → cover=null
 *  - Пресет без soft-секций → soft=null
 *  - Пресет с пустым section_structure → все null
 *  - Пресет с грид-сеткой → берётся student_grid превью
 *  - Fallback: если engine что-то не построил, берём первого мастера по role
 *  - Никогда не бросает исключения (даже если engine упадёт)
 */

import { describe, it, expect } from 'vitest';
import { buildPresetPreviewBundle } from '../preview-bundle';
import type { Preset } from '@/lib/rule-engine/types';
import type { RuleEngineBundle } from '@/lib/rule-engine/loaders';
import type {
  Placeholder,
  PhotoPlaceholder,
  TextPlaceholder,
  SpreadTemplate,
  TemplateSet,
  PageRole,
  SlotCapacity,
} from '@/lib/album-builder/types';

// ─── Фикстуры ───────────────────────────────────────────────────────────────

function photoSlot(label: string, opts: Partial<PhotoPlaceholder> = {}): PhotoPlaceholder {
  return {
    label,
    x_mm: 10,
    y_mm: 10,
    width_mm: 40,
    height_mm: 55,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
    ...opts,
  };
}

function textSlot(label: string): TextPlaceholder {
  return {
    label,
    x_mm: 10,
    y_mm: 70,
    width_mm: 40,
    height_mm: 8,
    type: 'text',
    font_family: 'Arial',
    font_size_pt: 10,
    font_weight: 'regular',
    color: '#000',
    align: 'left',
    vertical_align: 'top',
    auto_fit: false,
  };
}

function makeMaster(
  name: string,
  placeholders: Placeholder[],
  page_role: PageRole | null,
  slot_capacity: SlotCapacity | null,
  is_spread = false,
): SpreadTemplate {
  return {
    id: `id-${name}`,
    name,
    type: 'common',
    is_spread,
    width_mm: 200,
    height_mm: 280,
    placeholders,
    rules: null,
    sort_order: 0,
    applies_to_configs: [],
    default_for_configs: [],
    page_role,
    slot_capacity,
    is_fallback: false,
    mirror_for_soft: false,
    audit_notes: null,
  };
}

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'p1',
    display_name: 'Тестовый',
    print_type: 'layflat',
    pages_per_spread: 2,
    version: '1.0',
    sections: [],
    tenant_id: null,
    template_set_id: 'ts1',
    section_structure: [{ type: 'students' }],
    student_layout_mode: 'grid',
    student_grid_size: 4,
    sheet_type: 'hard',
    ...overrides,
  } as Preset;
}

function makeBundle(opts: {
  preset: Preset;
  masters: SpreadTemplate[];
}): RuleEngineBundle {
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of opts.masters) mastersByName.set(m.name, m);
  const templateSet: TemplateSet = {
    id: 'ts1',
    tenant_id: null,
    name: 't',
    slug: 't',
    print_type: 'layflat',
    page_width_mm: 200,
    page_height_mm: 280,
    spread_width_mm: 400,
    spread_height_mm: 280,
    bleed_mm: 0,
    facing_pages: true,
    page_binding: 'LeftToRight',
    spreads: opts.masters,
  };
  return {
    preset: opts.preset,
    rules: [],
    families: [],
    templateSet,
    mastersByName,
  };
}

// Удобные мастера для grid-режима
function makeGridMaster(students: number): SpreadTemplate {
  const placeholders: Placeholder[] = [];
  for (let i = 1; i <= students; i++) {
    placeholders.push(photoSlot(`StudentPhoto_${i}`));
    placeholders.push(textSlot(`StudentName_${i}`));
  }
  return makeMaster(
    `M-Grid-Page-${students}`,
    placeholders,
    'student_grid',
    { students, has_portrait: true, has_name: true },
  );
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe('buildPresetPreviewBundle (РЭ.24.3)', () => {
  it('Полный пресет с 4 секциями → все 4 SVG (или хотя бы 3, soft опц.)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        section_structure: [
          { type: 'soft_intro' },
          { type: 'students' },
          { type: 'teachers' },
        ],
        student_layout_mode: 'grid',
        student_grid_size: 4,
        sheet_type: 'soft', // soft_intro работает только для soft
      }),
      masters: [
        // Cover (отдельная сущность, не в section_structure)
        makeMaster('Cover-1', [photoSlot('CoverPhoto')], 'cover', null),
        // Grid student
        makeGridMaster(4),
        // Teachers
        makeMaster(
          'F-Head-WithPhoto',
          [photoSlot('HeadTeacherPhoto'), textSlot('HeadTeacherName')],
          'teacher_left',
          { head_teacher: 1, teachers: 0 },
        ),
        // Soft intro
        makeMaster(
          'S-Intro',
          [photoSlot('ClassPhotoFrame')],
          'intro',
          { photos_full: 1 },
        ),
      ],
    });
    const result = buildPresetPreviewBundle(bundle);
    expect(result.cover).not.toBeNull();
    expect(result.cover).toContain('<svg');
    expect(result.students).not.toBeNull();
    expect(result.students).toContain('<svg');
    expect(result.teachers).not.toBeNull();
    expect(result.teachers).toContain('<svg');
    expect(result.soft).not.toBeNull();
    expect(result.soft).toContain('<svg');
  });

  it('Пресет без cover-мастера → cover=null, остальные есть', () => {
    const bundle = makeBundle({
      preset: makePreset({
        section_structure: [{ type: 'students' }],
        student_layout_mode: 'grid',
        student_grid_size: 4,
      }),
      masters: [makeGridMaster(4)],
    });
    const result = buildPresetPreviewBundle(bundle);
    expect(result.cover).toBeNull();
    expect(result.students).not.toBeNull();
  });

  it('Пресет без soft-секций (layflat) → soft=null', () => {
    const bundle = makeBundle({
      preset: makePreset({
        sheet_type: 'hard',
        section_structure: [{ type: 'students' }, { type: 'teachers' }],
        student_layout_mode: 'grid',
        student_grid_size: 4,
      }),
      masters: [
        makeGridMaster(4),
        makeMaster(
          'F-Head-WithPhoto',
          [photoSlot('HeadTeacherPhoto')],
          'teacher_left',
          { head_teacher: 1, teachers: 0 },
        ),
      ],
    });
    const result = buildPresetPreviewBundle(bundle);
    expect(result.soft).toBeNull();
    expect(result.students).not.toBeNull();
    expect(result.teachers).not.toBeNull();
  });

  it('Пустой section_structure → engine status=failed → fallback заполняет по page_role', () => {
    const bundle = makeBundle({
      preset: makePreset({
        section_structure: [],
        student_layout_mode: null,
        student_grid_size: null,
      }),
      masters: [
        makeMaster('Cover-1', [photoSlot('CoverPhoto')], 'cover', null),
        makeGridMaster(6),
      ],
    });
    const result = buildPresetPreviewBundle(bundle);
    // Cover работает через прямой поиск по page_role, не через engine
    expect(result.cover).not.toBeNull();
    // Students подхвачен fallback'ом
    expect(result.students).not.toBeNull();
    // Teachers / soft — нет мастеров и нет секций
    expect(result.teachers).toBeNull();
    expect(result.soft).toBeNull();
  });

  it('Пресет с template_set без вообще никаких мастеров → все null (никаких ошибок)', () => {
    const bundle = makeBundle({
      preset: makePreset(),
      masters: [],
    });
    const result = buildPresetPreviewBundle(bundle);
    expect(result.cover).toBeNull();
    expect(result.students).toBeNull();
    expect(result.teachers).toBeNull();
    expect(result.soft).toBeNull();
  });

  it("Page-режим (mode='page') → берётся student_left превью", () => {
    const bundle = makeBundle({
      preset: makePreset({
        student_layout_mode: 'page',
        student_grid_size: null,
        section_structure: [{ type: 'students' }],
      }),
      masters: [
        makeMaster(
          'E-Standard-Left',
          [photoSlot('StudentPhoto'), textSlot('StudentName')],
          'student_left',
          { students: 1, has_portrait: true },
        ),
        makeMaster(
          'E-Standard-Right',
          [photoSlot('StudentPhoto')],
          'student_right',
          { students: 1, has_portrait: true },
        ),
      ],
    });
    const result = buildPresetPreviewBundle(bundle);
    expect(result.students).not.toBeNull();
    expect(result.students).toContain('<svg');
  });

  it('Функция никогда не бросает исключения — возвращает null поля', () => {
    // Минимальный bundle который может вызвать сбой engine'а
    const bundle = makeBundle({
      preset: makePreset({
        // некорректные параметры
        section_structure: null as unknown as Preset['section_structure'],
        student_layout_mode: null,
        student_grid_size: null,
      }),
      masters: [],
    });
    // Не должно бросить
    expect(() => buildPresetPreviewBundle(bundle)).not.toThrow();
    const result = buildPresetPreviewBundle(bundle);
    expect(result.cover).toBeNull();
    expect(result.students).toBeNull();
  });

  it('Cover-мастер — двухстраничный (is_spread=true) → превью валидное', () => {
    const bundle = makeBundle({
      preset: makePreset(),
      masters: [
        makeMaster(
          'Cover-Spread',
          [photoSlot('CoverPhoto'), photoSlot('CoverPhoto2', { x_mm: 220 })],
          'cover',
          null,
          true, // is_spread
        ),
      ],
    });
    const result = buildPresetPreviewBundle(bundle);
    expect(result.cover).not.toBeNull();
    expect(result.cover).toContain('<svg');
    // Разворотный мастер: viewBox должен быть шире обычного
    // (2 страницы + сгиб 4mm = 404)
    expect(result.cover).toContain('viewBox="0 0 404');
  });
});
