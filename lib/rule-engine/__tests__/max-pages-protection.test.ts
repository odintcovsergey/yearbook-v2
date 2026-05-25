/**
 * Тесты для РЭ.43: защита soft_intro и soft_final от max_pages-обрезки.
 *
 * Семантика soft binding требует чтобы первая страница (soft_intro) была
 * на форзаце, а последняя (soft_final) тоже на форзаце. При max_pages
 * перебор движок обрезает «с конца», но не должен трогать защищённые
 * секции — иначе страница-форзац исчезает, и физика обложки ломается.
 *
 * Покрытие:
 *  - max_pages не превышен → ничего не обрезается, поведение прежнее
 *  - max_pages превышен на 1, soft_final есть → обрезается студенческая
 *    страница из середины, soft_final сохранён
 *  - max_pages превышен сильнее → обрезаются последние не-защищённые
 *    страницы, soft_intro и soft_final остаются
 *  - max_pages = только защищённые → warning partial_truncation
 *  - Layflat альбом без soft_intro/soft_final → старое поведение (обрезка с конца)
 *  - section_type проставляется во все страницы (тегирование)
 */

import { describe, it, expect } from 'vitest';
import { buildFromSectionStructure } from '../build-from-section-structure';
import type { Preset, RulesAlbumInput } from '../types';
import type { RuleEngineBundle } from '../loaders';
import type {
  Placeholder,
  SlotCapacity,
  PageRole,
  SpreadTemplate,
  TemplateSet,
} from '@/lib/album-builder/types';

function photoSlot(label: string): Placeholder {
  return {
    label,
    x_mm: 0,
    y_mm: 0,
    width_mm: 100,
    height_mm: 100,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
  };
}

function makeMaster(
  name: string,
  placeholders: Placeholder[],
  page_role: PageRole | null,
  slot_capacity: SlotCapacity | null,
): SpreadTemplate {
  return {
    id: `id-${name}`,
    name,
    type: 'common',
    is_spread: false,
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

function makePreset(opts: Partial<Preset> & Pick<Preset, 'id'>): Preset {
  return {
    id: opts.id,
    display_name: opts.display_name ?? 'Test',
    print_type: opts.print_type ?? 'soft',
    pages_per_spread: opts.pages_per_spread ?? 2,
    version: opts.version ?? '1.0',
    sections: opts.sections ?? [],
    tenant_id: opts.tenant_id ?? null,
    section_structure: opts.section_structure ?? null,
    density: opts.density ?? null,
    sheet_type: opts.sheet_type ?? 'soft',
    student_layout_mode: opts.student_layout_mode ?? null,
    student_grid_size: opts.student_grid_size ?? null,
    student_friend_photos: opts.student_friend_photos ?? null,
    student_has_quote: opts.student_has_quote ?? null,
    student_pages_per_student: opts.student_pages_per_student ?? null,
    min_pages: opts.min_pages ?? null,
    max_pages: opts.max_pages ?? null,
  };
}

function makeBundle(opts: {
  preset: Preset;
  masters: SpreadTemplate[];
}): RuleEngineBundle {
  const mastersByName = new Map<string, SpreadTemplate>();
  for (const m of opts.masters) mastersByName.set(m.name, m);
  const templateSet: TemplateSet = {
    id: 'ts',
    tenant_id: null,
    name: 't',
    slug: 't',
    print_type: 'soft',
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

function makeInput(): RulesAlbumInput {
  return {
    students: Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      name: `Student ${i}`,
      photo: `https://cdn/s${i}.jpg`,
      quote: '',
      friend_photos: [],
    })),
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: ['https://cdn/full0.jpg'],
      half_class: ['https://cdn/h0.jpg', 'https://cdn/h1.jpg'],
      spread: [],
      quarter: [],
      sixth: Array.from({ length: 6 }, (_, i) => `https://cdn/six${i}.jpg`),
    },
  };
}

// Тестовые мастера: soft_intro / soft_final + grid 12 для students +
// J-мастер для common_required.
function makeAllMasters(): SpreadTemplate[] {
  return [
    makeMaster('S-Intro', [photoSlot('classphotoframe')], 'intro', {
      photos_full: 1,
    }),
    makeMaster('S-Final', [photoSlot('classphotoframe')], 'final', {
      photos_full: 1,
    }),
    makeMaster(
      'N-Grid-Page',
      Array.from({ length: 12 }, (_, i) => photoSlot(`studentportrait_${i + 1}`)),
      'student_grid',
      {
        students: 12,
        photos_full: 0,
        has_quote: false,
        has_portrait: true,
        has_name: true,
      },
    ),
    makeMaster(
      'N-Grid-Page-10',
      Array.from({ length: 10 }, (_, i) => photoSlot(`studentportrait_${i + 1}`)),
      'student_grid',
      {
        students: 10,
        photos_full: 0,
        has_quote: false,
        has_portrait: true,
        has_name: true,
      },
    ),
    makeMaster('J-Half', [photoSlot('halfphoto_1'), photoSlot('halfphoto_2')], 'common', null),
    makeMaster(
      'J-Collage-6',
      Array.from({ length: 6 }, (_, i) => photoSlot(`collagephoto_${i + 1}`)),
      'common',
      null,
    ),
  ];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('РЭ.43: тегирование страниц section_type', () => {
  it('Все страницы получают section_type соответствующий своей секции', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        student_layout_mode: 'grid',
        student_grid_size: 12,
        section_structure: [
          { type: 'soft_intro' },
          { type: 'students' },
          { type: 'soft_final' },
        ],
      }),
      masters: makeAllMasters(),
    });
    const result = buildFromSectionStructure(bundle, makeInput());

    // Достанем из spreads page instances через cast (тип PageInstance с section_type).
    const allPages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    // soft_intro первая → section_type='soft_intro'
    expect(allPages[0]).toBeDefined();
    expect((allPages[0] as unknown as { section_type: string }).section_type).toBe('soft_intro');
    // Последняя → soft_final
    const lastPage = allPages[allPages.length - 1];
    expect((lastPage as unknown as { section_type: string }).section_type).toBe('soft_final');
    // Между ними — students
    for (let i = 1; i < allPages.length - 1; i++) {
      expect((allPages[i] as unknown as { section_type: string }).section_type).toBe('students');
    }
  });
});

describe('РЭ.43: max_pages защита soft_intro/soft_final', () => {
  it('max_pages не превышен → ничего не обрезается', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        student_layout_mode: 'grid',
        student_grid_size: 12,
        max_pages: 100, // намеренно с запасом
        section_structure: [
          { type: 'soft_intro' },
          { type: 'students' },
          { type: 'soft_final' },
        ],
      }),
      masters: makeAllMasters(),
    });
    const result = buildFromSectionStructure(bundle, makeInput());

    expect(
      result.warnings.some((w) => w.startsWith('pages_overflow')),
    ).toBe(false);
  });

  it('max_pages превышен → soft_final сохранён, обрезается из общего раздела', () => {
    // 30 учеников → 3 страницы по 10 = 3 student pages. + intro + final + 2 общих = 7
    // max_pages=6 → нужно обрезать 1. РЭ.43: обрезаем последний J-Collage-6
    // (НЕ soft_final).
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        student_layout_mode: 'grid',
        student_grid_size: 12,
        max_pages: 6,
        section_structure: [
          { type: 'soft_intro' },
          { type: 'students' },
          {
            type: 'common_required',
            pages: [
              { master_name: 'J-Half' },
              { master_name: 'J-Collage-6' },
            ],
          },
          { type: 'soft_final' },
        ],
      }),
      masters: makeAllMasters(),
    });
    const result = buildFromSectionStructure(bundle, makeInput());

    const allPages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    // Должно остаться 6 страниц.
    expect(allPages).toHaveLength(6);

    // soft_intro первая, soft_final последняя — оба ОБЯЗАНЫ сохраниться.
    const intro = allPages[0];
    expect((intro as unknown as { section_type: string }).section_type).toBe('soft_intro');
    expect((intro as unknown as { master_id: string }).master_id).toBe('id-S-Intro');

    const final = allPages[allPages.length - 1];
    expect((final as unknown as { section_type: string }).section_type).toBe('soft_final');
    expect((final as unknown as { master_id: string }).master_id).toBe('id-S-Final');

    // Должно быть предупреждение pages_overflow_truncated с упоминанием защиты.
    const w = result.warnings.find((x) => x.startsWith('pages_overflow_truncated'));
    expect(w).toBeDefined();
    expect(w).toContain('soft_intro/soft_final защищены');

    // J-Collage-6 (последний из common_required) обрезан, J-Half остался.
    const masterIds = allPages.map(
      (p) => (p as unknown as { master_id: string }).master_id,
    );
    expect(masterIds).toContain('id-J-Half');
    expect(masterIds).not.toContain('id-J-Collage-6');
  });

  it('max_pages превышен сильнее — обрезается несколько не-защищённых страниц', () => {
    // intro + 3 students + 2 common + final = 7. max_pages=4 → обрезать 3.
    // Защищены intro+final = 2 страницы. Оставшиеся 2 слота — из middle (students).
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        student_layout_mode: 'grid',
        student_grid_size: 12,
        max_pages: 4,
        section_structure: [
          { type: 'soft_intro' },
          { type: 'students' },
          {
            type: 'common_required',
            pages: [
              { master_name: 'J-Half' },
              { master_name: 'J-Collage-6' },
            ],
          },
          { type: 'soft_final' },
        ],
      }),
      masters: makeAllMasters(),
    });
    const result = buildFromSectionStructure(bundle, makeInput());

    const allPages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    expect(allPages).toHaveLength(4);

    // Первая = soft_intro, последняя = soft_final.
    expect((allPages[0] as unknown as { section_type: string }).section_type).toBe('soft_intro');
    expect(
      (allPages[allPages.length - 1] as unknown as { section_type: string }).section_type,
    ).toBe('soft_final');

    // Между ними 2 страницы — обе common_required обрезаны (они идут после
    // students, последние в очереди на обрезку), осталось 2 students.
    const middle = allPages.slice(1, -1);
    expect(middle).toHaveLength(2);
    for (const p of middle) {
      expect((p as unknown as { section_type: string }).section_type).toBe('students');
    }
  });

  it('max_pages меньше чем число защищённых → partial_truncation warning', () => {
    // intro + students + final = 5. max_pages=1 → защищённых 2 (intro+final),
    // обрезать должны 4. Removable = 3 (3 student pages). После обрезки
    // останется 2 (intro+final), что > max_pages=1 → partial warning.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'soft',
        student_layout_mode: 'grid',
        student_grid_size: 12,
        max_pages: 1,
        section_structure: [
          { type: 'soft_intro' },
          { type: 'students' },
          { type: 'soft_final' },
        ],
      }),
      masters: makeAllMasters(),
    });
    const result = buildFromSectionStructure(bundle, makeInput());

    const allPages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    // Защищены 2 (intro+final) — они остались, students все обрезаны.
    expect(allPages).toHaveLength(2);
    expect((allPages[0] as unknown as { section_type: string }).section_type).toBe('soft_intro');
    expect((allPages[1] as unknown as { section_type: string }).section_type).toBe('soft_final');

    // Warning partial_truncation.
    const w = result.warnings.find((x) =>
      x.startsWith('pages_overflow_partial_truncation'),
    );
    expect(w).toBeDefined();
    expect(w).toContain('Увеличьте max_pages');
  });

  it('Layflat (hard) альбом без soft_intro/soft_final → старое поведение (обрезка с конца)', () => {
    // teachers/students/vignette не защищены — обрезка работает по-прежнему.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        sheet_type: 'hard',
        student_layout_mode: 'grid',
        student_grid_size: 12,
        max_pages: 2,
        section_structure: [
          { type: 'students' },
          {
            type: 'common_required',
            pages: [
              { master_name: 'J-Half' },
              { master_name: 'J-Collage-6' },
            ],
          },
        ],
      }),
      masters: makeAllMasters(),
    });
    const result = buildFromSectionStructure(bundle, makeInput());

    const allPages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    expect(allPages).toHaveLength(2);

    // Обрезались последние common_required страницы, остались первые 2.
    // Это students (так как они идут первыми).
    for (const p of allPages) {
      expect((p as unknown as { section_type: string }).section_type).toBe('students');
    }
  });
});
