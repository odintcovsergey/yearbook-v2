/**
 * Тесты для buildGridSemantic (РЭ.22.6): семантический поиск мастера
 * для двух-осевой модели mode='grid' (сетка N учеников на страницу).
 *
 * Покрывают:
 *  - Base-сетка: точное совпадение students=grid_size
 *  - Полные страницы заполняются base-мастером
 *  - Combined-tail когда available.full_class >= 1 + есть мастер с photos_full=1
 *  - Adaptive-tail (мастер меньше base) когда combined не подошёл
 *  - Fallback на base с null-padding если нет adaptive
 *  - has_quote=true / false → engine выбирает соответствующий мастер
 *  - grid_size не задан → warning, секция не строится
 *  - Base не найден → warning, секция не строится
 *  - mode=NULL → fallback на legacy buildGrid
 *  - Decision trace содержит grid_semantic:*
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

// ─── Фикстуры ────────────────────────────────────────────────────────────────

function photoSlot(label: string): Placeholder {
  return {
    label,
    x_mm: 0,
    y_mm: 0,
    width_mm: 40,
    height_mm: 55,
    type: 'photo',
    fit: 'fill_proportional',
    required: false,
  };
}

function textSlot(label: string): Placeholder {
  return {
    label,
    x_mm: 0,
    y_mm: 0,
    width_mm: 40,
    height_mm: 10,
    type: 'text',
    font_family: 'Arial',
    font_size_pt: 12,
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
): SpreadTemplate {
  return {
    id: `id-${name}`,
    name,
    type: 'student',
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

/** Helper: создаёт grid-мастер с N учениками (portrait_1..N + name_1..N). */
function makeGridMaster(
  name: string,
  studentsCount: number,
  opts: { hasQuote?: boolean; photosFull?: number } = {},
): SpreadTemplate {
  const placeholders: Placeholder[] = [];
  for (let i = 1; i <= studentsCount; i++) {
    placeholders.push(photoSlot(`studentportrait_${i}`));
    placeholders.push(textSlot(`studentname_${i}`));
    if (opts.hasQuote) placeholders.push(textSlot(`studentquote_${i}`));
  }
  if (opts.photosFull && opts.photosFull > 0) {
    placeholders.push(photoSlot('classphotoframe'));
  }
  const slotCap: SlotCapacity = {
    students: studentsCount,
    has_portrait: true,
    has_name: true,
    has_quote: !!opts.hasQuote,
  };
  if (opts.photosFull && opts.photosFull > 0) {
    slotCap.photos_full = opts.photosFull;
  }
  return makeMaster(name, placeholders, 'student_grid', slotCap);
}

// Medium-стиль: 4 ученика, с цитатами.
const M_GRID = makeGridMaster('M-Grid-Page', 4, { hasQuote: true });
// 2 ученика + 1 общая фотка (Medium-combined).
const M_COMBINED = makeGridMaster('M-Combined-Page', 2, {
  hasQuote: true,
  photosFull: 1,
});

// Light-стиль: 6 учеников, без цитат.
const L_GRID = makeGridMaster('L-Grid-Page', 6);
// 3 + 1 общая.
const L_COMBINED = makeGridMaster('L-Combined-Page', 3, { photosFull: 1 });
// Адаптивные хвосты для Light: 2 и 4 ученика.
const L_2 = makeGridMaster('L-2', 2);
const L_4 = makeGridMaster('L-4', 4);

// Mini-стиль: 12 учеников.
const N_GRID = makeGridMaster('N-Grid-Page', 12);

function makePreset(opts: Partial<Preset> & Pick<Preset, 'id'>): Preset {
  return {
    id: opts.id,
    display_name: opts.display_name ?? 'Test',
    print_type: opts.print_type ?? 'layflat',
    pages_per_spread: opts.pages_per_spread ?? 2,
    version: opts.version ?? '1.0',
    sections: opts.sections ?? [],
    tenant_id: opts.tenant_id ?? null,
    section_structure: opts.section_structure ?? null,
    density: opts.density ?? null,
    sheet_type: opts.sheet_type ?? null,
    student_layout_mode: opts.student_layout_mode ?? null,
    student_grid_size: opts.student_grid_size ?? null,
    student_friend_photos: opts.student_friend_photos ?? null,
    student_has_quote: opts.student_has_quote ?? null,
    student_pages_per_student: opts.student_pages_per_student ?? null,
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

function makeInput(opts: {
  students_count: number;
  full_class_count?: number;
}): RulesAlbumInput {
  return {
    students: Array.from({ length: opts.students_count }, (_, i) => ({
      full_name: `Student ${i}`,
      quote: `Quote ${i}`,
      portrait: `https://cdn/p${i}.jpg`,
      friend_photos: [],
    })),
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: Array.from(
        { length: opts.full_class_count ?? 0 },
        (_, i) => `https://cdn/full${i}.jpg`,
      ),
      half_class: [],
      spread: [],
      quarter: [],
      sixth: [],
    },
    // РЭ.51: явно greedy чтобы хвост шёл на ОТДЕЛЬНУЮ страницу
    // (полная + хвост) — это то поведение которое проверяют все
    // тесты ниже. С auto распределением engine разбил бы 7 на 4+3.
    student_distribution: 'greedy',
  };
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe("mode='grid' семантический поиск (РЭ.22.6)", () => {
  it('Medium-стиль: 8 учеников, grid_size=4 → 2 полные страницы M-Grid-Page', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'medium',
        student_layout_mode: 'grid',
        student_grid_size: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [M_GRID, M_COMBINED],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students_count: 8 }));

    // 8 учеников / 4 на страницу = 2 страницы → 1 разворот.
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-M-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-M-Grid-Page');

    // Bindings первой страницы — первые 4 ученика.
    const left = result.spreads[0].left!;
    expect(left.bindings.studentportrait_1).toBe('https://cdn/p0.jpg');
    expect(left.bindings.studentportrait_4).toBe('https://cdn/p3.jpg');
    expect(left.bindings.studentquote_1).toBe('Quote 0');
  });

  it('Light: 7 учеников, grid_size=6, нет full_class → L-Grid с __hidden__ (РЭ.40)', () => {
    // РЭ.40: 7 учеников = 6 + 1, обе страницы L-Grid-Page.
    // Adaptive masters (L-2) больше не выбираются — хвост идёт в base
    // с __hidden__ на слотах 2-6.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'light',
        student_layout_mode: 'grid',
        student_grid_size: 6,
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      masters: [L_GRID, L_2, L_4, L_COMBINED],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 7 }),
    );

    expect(result.spreads).toHaveLength(1);
    // Левая — полная сетка L-Grid-Page (6 учеников)
    expect(result.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
    // Правая — тоже L-Grid-Page (хвост 1 ученика в полном мастере с __hidden__)
    expect(result.spreads[0].right?.master_id).toBe('id-L-Grid-Page');
    // Слот 1 заполнен последним учеником, слоты 2-6 скрыты.
    expect(result.spreads[0].right?.bindings.studentportrait_1).toBe(
      'https://cdn/p6.jpg',
    );
    expect(result.spreads[0].right?.bindings.__hidden__studentportrait_2).toBe('1');
  });

  it('Light: 7 учеников + 1 full_class → combined-tail вместо adaptive', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'light',
        student_layout_mode: 'grid',
        student_grid_size: 6,
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      masters: [L_GRID, L_2, L_4, L_COMBINED],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 7, full_class_count: 1 }),
    );

    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
    // Правая — L-Combined-Page (3 ученика + 1 фото), но учеников всего 1.
    // По логике combined ищется как min_fit с students>=1 и photos_full=1.
    // L-Combined-Page имеет students=3, что >= 1 — подходит.
    expect(result.spreads[0].right?.master_id).toBe('id-L-Combined-Page');
    expect(result.spreads[0].right?.bindings.classphotoframe).toBe(
      'https://cdn/full0.jpg',
    );
  });

  it('has_quote=true → engine отсеивает мастера без quote-слотов', () => {
    // Создаём два мастера 4-учеников: с цитатами и без. has_quote=true → engine
    // должен выбрать M-Grid-Page (с цитатами).
    const noQuoteMaster = makeGridMaster('Other-4-NoQuote', 4);
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom',
        student_layout_mode: 'grid',
        student_grid_size: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [M_GRID, noQuoteMaster],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students_count: 4 }));

    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-M-Grid-Page');
  });

  it('grid_size не задан → warning, секция не строится', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom',
        student_layout_mode: 'grid',
        student_grid_size: null, // <-- ключевое
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      masters: [L_GRID],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 5 }),
    );
    expect(result.spreads).toHaveLength(0);
    const warn = result.warnings.find((w) => w.includes('students_grid_size_missing'));
    expect(warn).toBeDefined();
  });

  it('Base-мастер не найден → warning, секция не строится', () => {
    // Запрос: students=5, но в template_set только L-Grid-Page (students=6).
    // Exact-match для 5 нет → base не найден.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom',
        student_layout_mode: 'grid',
        student_grid_size: 5,
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      masters: [L_GRID], // 6 учеников, точный 5 не подойдёт
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 10 }),
    );
    expect(result.spreads).toHaveLength(0);
    const warn = result.warnings.find((w) => w.includes('students_master_not_found'));
    expect(warn).toBeDefined();
    expect(warn).toContain('mode=grid');
    expect(warn).toContain('students=5');
  });

  it('Fallback tail_padded: 7 учеников, grid_size=6, нет adaptive < 6 → base с __hidden__', () => {
    // РЭ.40+31.3: 7 учеников = 6 + 1. Хвост в L-Grid-Page,
    // первый слот заполнен, 2-6 скрыты через __hidden__.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'custom',
        student_layout_mode: 'grid',
        student_grid_size: 6,
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      masters: [L_GRID], // нет ни L-2, ни L-Combined
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 7 }),
    );

    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-L-Grid-Page');
    // У хвоста первый слот заполнен, 2-6 скрыты через __hidden__.
    expect(result.spreads[0].right?.bindings.studentportrait_1).toBe(
      'https://cdn/p6.jpg',
    );
    expect(result.spreads[0].right?.bindings.__hidden__studentportrait_2).toBe('1');
    expect(result.spreads[0].right?.bindings.__hidden__studentportrait_6).toBe('1');
    // РЭ.40: warning students_grid_tail_padded больше не выдаётся.
  });

  it("mode=NULL + density='light' → fallback на legacy buildGrid", () => {
    // Legacy buildGrid ищет мастер по жёсткому имени L-Grid-Page без
    // page_role/slot_capacity (для legacy записей).
    const legacyL = makeMaster(
      'L-Grid-Page',
      // 6 portrait + name + quote (для пустых строк bindGridStudents)
      [
        photoSlot('studentportrait_1'),
        photoSlot('studentportrait_2'),
        photoSlot('studentportrait_3'),
        photoSlot('studentportrait_4'),
        photoSlot('studentportrait_5'),
        photoSlot('studentportrait_6'),
      ],
      null, // legacy: без page_role
      null, // legacy: без slot_capacity
    );

    const bundle = makeBundle({
      preset: makePreset({
        id: 'light',
        density: 'light',
        student_layout_mode: null, // <-- legacy путь
        section_structure: [{ type: 'students' }],
      }),
      masters: [legacyL],
    });
    const result = buildFromSectionStructure(bundle, makeInput({ students_count: 6 }));

    // Legacy buildGrid использует defaultSlots=6 для Light когда нет slot_capacity.
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
  });

  it('Decision trace содержит grid_semantic с mode и pageIdx (РЭ.40)', () => {
    // РЭ.40: rule_id формат изменился с 'grid_semantic:base:...' и
    // 'grid_semantic:adaptive_tail:...' на унифицированный
    // 'grid_semantic:${mode}:${pageIdx}'. Для 7 учеников = 6+1
    // ожидаем 2 trace entry: pageIdx=0 и pageIdx=1, mode='auto'.
    const bundle = makeBundle({
      preset: makePreset({
        id: 'light',
        student_layout_mode: 'grid',
        student_grid_size: 6,
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      masters: [L_GRID, L_2],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 7 }),
    );

    const traces = result.decision_trace.filter((t) =>
      t.rule_id?.startsWith('grid_semantic:'),
    );
    expect(traces.length).toBeGreaterThanOrEqual(2);
    // Все мастера в trace — L-Grid-Page (РЭ.40: adaptive не выбираются).
    for (const t of traces) {
      expect(t.inputs.master_name).toBe('L-Grid-Page');
    }
  });

  it('Mini: 24 ученика, grid_size=12 → 2 полные страницы N-Grid-Page', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'mini',
        student_layout_mode: 'grid',
        student_grid_size: 12,
        student_has_quote: false,
        section_structure: [{ type: 'students' }],
      }),
      masters: [N_GRID],
    });
    const result = buildFromSectionStructure(
      bundle,
      makeInput({ students_count: 24 }),
    );

    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].left?.master_id).toBe('id-N-Grid-Page');
    expect(result.spreads[0].right?.master_id).toBe('id-N-Grid-Page');
  });

  // ─── РЭ.37.9: fallback на hasQuote=false ─────────────────────────────────
  //
  // Когда партнёр в пресете выбрал has_quote=true, но в template_set нет
  // мастера-сетки с цитатами — engine должен взять мастер без цитат
  // (если он есть) вместо того чтобы вообще не строить секцию.
  // Info-warning должен объяснить ситуацию партнёру.

  describe('РЭ.37.9: quote fallback', () => {
    it('has_quote=true, мастер с цитатами отсутствует, мастер БЕЗ цитат есть → fallback + info warning', () => {
      // В template_set только L-Grid (без цитат). Партнёр просит цитаты.
      const bundle = makeBundle({
        preset: makePreset({
          id: 'light-with-quote',
          student_layout_mode: 'grid',
          student_grid_size: 6,
          student_has_quote: true,
          section_structure: [{ type: 'students' }],
        }),
        masters: [L_GRID], // L_GRID без quote
      });
      const result = buildFromSectionStructure(bundle, makeInput({ students_count: 12 }));

      // Секция всё-таки построилась
      expect(result.spreads).toHaveLength(1);
      expect(result.spreads[0].left?.master_id).toBe('id-L-Grid-Page');
      expect(result.spreads[0].right?.master_id).toBe('id-L-Grid-Page');

      // Info warning о fallback
      expect(
        result.warnings.some((w) => w.startsWith('students_quote_fallback')),
      ).toBe(true);

      // НЕ должен быть финальный students_master_not_found
      expect(
        result.warnings.some((w) => w.startsWith('students_master_not_found')),
      ).toBe(false);

      // Decision trace про fallback
      expect(
        result.decision_trace.some((t) =>
          t.rule_id?.startsWith('grid_semantic:quote_fallback:'),
        ),
      ).toBe(true);
    });

    it('has_quote=true, мастер с цитатами есть → fallback НЕ срабатывает (контроль)', () => {
      // M_GRID с цитатами доступен.
      const bundle = makeBundle({
        preset: makePreset({
          id: 'medium-with-quote',
          student_layout_mode: 'grid',
          student_grid_size: 4,
          student_has_quote: true,
          section_structure: [{ type: 'students' }],
        }),
        masters: [M_GRID],
      });
      const result = buildFromSectionStructure(bundle, makeInput({ students_count: 8 }));

      expect(result.spreads).toHaveLength(1);
      expect(
        result.warnings.some((w) => w.startsWith('students_quote_fallback')),
      ).toBe(false);
    });

    it('has_quote=true, мастеров ВООБЩЕ нет → warning master_not_found (новая формулировка)', () => {
      // В template_set только M_GRID (4 ученика), но мы просим grid_size=6.
      const bundle = makeBundle({
        preset: makePreset({
          id: 'no-master',
          student_layout_mode: 'grid',
          student_grid_size: 6,
          student_has_quote: true,
          section_structure: [{ type: 'students' }],
        }),
        masters: [M_GRID], // только 4-слотный, не подходит для grid_size=6
      });
      const result = buildFromSectionStructure(bundle, makeInput({ students_count: 12 }));

      // Секция не построилась
      expect(result.spreads).toHaveLength(0);
      // Warning master_not_found с упоминанием обоих вариантов hasQuote
      const w = result.warnings.find((x) => x.startsWith('students_master_not_found'));
      expect(w).toBeDefined();
      expect(w).toMatch(/has_quote=true.*has_quote=false/);
    });
  });
});
