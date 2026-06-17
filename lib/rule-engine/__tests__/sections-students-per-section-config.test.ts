/**
 * ТЗ 17.06.2026: per-section конфиг личного раздела + несколько секций students
 * + режим multi_spread.
 *
 * Покрывает §6 ТЗ:
 *  - две секции students (spread + grid) → обе раскладывают ВЕСЬ класс;
 *  - spread с диапазоном friends_min..max → мастер под факт. число фото (clamp);
 *  - multi_spread: распределение по разворотам + degrade без галерейных мастеров;
 *  - grid per_page → сетка нужного размера;
 *  - legacy-пресет без config → старое поведение (глобальные поля);
 *  - сворачивание глобальных полей в config (эквивалентность).
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

// ─── Фикстуры ──────────────────────────────────────────────────────────────

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

// Левая парадная страница: портрет + имя, без фото и цитат.
const E_LEFT = makeMaster(
  'E-Left',
  [photoSlot('studentportrait_1'), textSlot('studentname_1')],
  'student_left',
  { students: 1, photos_friend: 0, has_quote: false, has_portrait: true, has_name: true },
);

// Правые страницы под разное число фото с друзьями (+ цитата).
function rightMaster(n: number): SpreadTemplate {
  const ph: Placeholder[] = [textSlot('studentquote_1')];
  for (let i = 1; i <= n; i++) ph.push(photoSlot(`studentphoto_${i}`));
  return makeMaster(`E-Right-${n}`, ph, 'student_right', {
    students: 1,
    photos_friend: n,
    has_quote: true,
    has_portrait: false,
    has_name: false,
  });
}
const E_RIGHT_2 = rightMaster(2);
const E_RIGHT_3 = rightMaster(3);
const E_RIGHT_4 = rightMaster(4);

// Grid-мастер на 16 учеников.
const GRID_16 = (() => {
  const ph: Placeholder[] = [];
  for (let i = 1; i <= 16; i++) {
    ph.push(photoSlot(`studentportrait_${i}`));
    ph.push(textSlot(`studentname_${i}`));
  }
  return makeMaster('GRID-16', ph, 'student_grid', {
    students: 16,
    photos_full: 0,
    has_quote: false,
    has_portrait: true,
    has_name: true,
  });
})();

// Галерейные мастера для multi_spread: фото-страницы БЕЗ портрета.
function galleryMaster(name: string, role: PageRole, n: number): SpreadTemplate {
  const ph: Placeholder[] = [];
  for (let i = 1; i <= n; i++) ph.push(photoSlot(`studentphoto_${i}`));
  return makeMaster(name, ph, role, {
    students: 0,
    photos_friend: n,
    has_quote: false,
    has_portrait: false,
    has_name: false,
  });
}
const GALLERY_LEFT = galleryMaster('Gallery-Left', 'student_left', 4);
const GALLERY_RIGHT = galleryMaster('Gallery-Right', 'student_right', 4);

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

function makeBundle(opts: { preset: Preset; masters: SpreadTemplate[] }): RuleEngineBundle {
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
  return { preset: opts.preset, rules: [], families: [], templateSet, mastersByName };
}

function makeInput(friendCounts: number[]): RulesAlbumInput {
  return {
    students: friendCounts.map((fc, i) => ({
      full_name: `Student ${i}`,
      quote: `Quote ${i}`,
      portrait: `https://cdn/p${i}.jpg`,
      friend_photos: Array.from({ length: fc }, (_, j) => `https://cdn/p${i}_f${j}.jpg`),
    })),
    subjects: [],
    head_teacher: { photo: null, name: '', role: '', text: '' },
    common_photos: {
      full_class: [],
      half_class: [],
      spread: [],
      quarter: [],
      sixth: [],
      collage: [],
    },
  };
}

function masterNameById(bundle: RuleEngineBundle, id: string | null): string | null {
  if (!id) return null;
  for (const m of Array.from(bundle.mastersByName.values())) {
    if (m.id === id) return m.name;
  }
  return null;
}

// ─── Тесты ───────────────────────────────────────────────────────────────

describe('per-section config личного раздела (ТЗ 17.06.2026)', () => {
  it('две секции students (spread + grid) → обе раскладывают ВЕСЬ класс, порядок сохранён', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'students', config: { mode: 'spread', friends_min: 0, friends_max: 4, quote: true } },
          { type: 'students', config: { mode: 'grid', per_page: 16 } },
        ],
      }),
      masters: [E_LEFT, E_RIGHT_2, E_RIGHT_3, E_RIGHT_4, GRID_16],
    });
    const result = buildFromSectionStructure(bundle, makeInput([3, 3, 3]));

    // Spread-секция: 3 ученика × 2 страницы = 6 = 3 разворота.
    // Grid-секция: 3 ученика → 1 grid-страница (padded).
    // Всего страниц = 6 + 1 = 7.
    const allPages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    expect(allPages).toHaveLength(7);

    // Последняя страница — grid-мастер на 16.
    const gridPage = allPages.find((p) => p!.master_id === 'id-GRID-16');
    expect(gridPage).toBeTruthy();
    // В grid-странице разложены все 3 ученика.
    expect(gridPage!.bindings.studentname_1).toBe('Student 0');
    expect(gridPage!.bindings.studentname_3).toBe('Student 2');

    // Spread-секция тоже разложила всех 3 (есть правые мастера на 3 фото).
    const spreadPages = allPages.filter((p) => p!.master_id?.startsWith('id-E-Right'));
    expect(spreadPages).toHaveLength(3);
  });

  it('spread диапазон 0–4: clamp факт. числа фото на ученика', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'students', config: { mode: 'spread', friends_min: 2, friends_max: 4, quote: true } },
        ],
      }),
      masters: [E_LEFT, E_RIGHT_2, E_RIGHT_3, E_RIGHT_4],
    });
    // ученик 0: 3 фото → 3; ученик 1: 5 фото → clamp 4; ученик 2: 1 фото → clamp 2.
    const result = buildFromSectionStructure(bundle, makeInput([3, 5, 1]));
    const rights = result.spreads
      .map((s) => s.right)
      .filter(Boolean)
      .map((p) => masterNameById(bundle, p!.master_id));
    expect(rights).toEqual(['E-Right-3', 'E-Right-4', 'E-Right-2']);
  });

  it('multi_spread «Авто»: парад слева, дальше коллажи под число фото', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'students', config: { mode: 'multi_spread', spreads_per_student: 2, quote: true } },
        ],
      }),
      // E_RIGHT_4 содержит цитату → НЕ коллаж; коллажи = GALLERY_* (4 фото, чистые).
      masters: [E_LEFT, E_RIGHT_4, GALLERY_LEFT, GALLERY_RIGHT],
    });
    // ученик с 12 фото, cap 2 разворота: парад(0 фото) + 3 коллажа × 4 = 12.
    const result = buildFromSectionStructure(bundle, makeInput([12]));
    const pages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    expect(pages).toHaveLength(4); // 2 разворота × 2 страницы

    // Левая 1-й страницы — парад (портрет). Дубля портрета на правой НЕТ.
    expect(masterNameById(bundle, pages[0]!.master_id)).toBe('E-Left');
    // Остальные три — коллажные мастера (без портрета).
    for (const p of pages.slice(1)) {
      expect(masterNameById(bundle, p!.master_id)!.startsWith('Gallery-')).toBe(true);
    }

    // Фото идут подряд без дублей: правая 1-го разворота с offset 0,
    // левая 2-го — с offset 4, правая 2-го — с offset 8.
    expect(pages[1]!.bindings.studentphoto_1).toBe('https://cdn/p0_f0.jpg');
    expect(pages[2]!.bindings.studentphoto_1).toBe('https://cdn/p0_f4.jpg');
    expect(pages[3]!.bindings.studentphoto_1).toBe('https://cdn/p0_f8.jpg');
  });

  it('multi_spread Авто: РАВНОМЕРНОЕ распределение (13 фото → 5+4+4, без почти-пустой)', () => {
    // Полная лесенка коллажей 2..6 (как в «Аква меч»).
    const collages = [2, 3, 4, 5, 6].map((n) =>
      galleryMaster(`E-Collage-${n}`, 'student_right', n),
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'students', config: { mode: 'multi_spread', spreads_per_student: 3, quote: true } },
        ],
      }),
      masters: [E_LEFT, ...collages],
    });
    const result = buildFromSectionStructure(bundle, makeInput([13]));
    const pages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    const names = pages.map((p) => masterNameById(bundle, p!.master_id));
    // Парад + 5+4+4 = 13 (а не жадно 6+6+1 с почти-пустой страницей).
    expect(names).toEqual(['E-Left', 'E-Collage-5', 'E-Collage-4', 'E-Collage-4']);
    // Ни на одной коллажной странице нет скрытых (пустых) слотов.
    const anyHidden = pages
      .slice(1)
      .some((p) => Object.keys(p!.bindings).some((k) => k.startsWith('__hidden__')));
    expect(anyHidden).toBe(false);
  });

  it('multi_spread: коллаж распознаётся по РЕАЛЬНЫМ слотам, даже если метаданные врут', () => {
    // Мастер с фото-слотами и БЕЗ портрета/имени в плейсхолдерах, но slot_capacity
    // ЛЖЁТ (has_portrait=true). Так в «Аква меч» устроен E-Standard-Right.
    // Движок обязан распознать его как коллаж по реальным слотам.
    const liar = makeMaster(
      'Liar-Right',
      [photoSlot('studentphoto_1'), photoSlot('studentphoto_2'), photoSlot('studentphoto_3')],
      'student_right',
      { students: 1, photos_friend: 3, has_quote: true, has_portrait: true, has_name: true },
    );
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'students', config: { mode: 'multi_spread', spreads_per_student: 2, quote: true } },
        ],
      }),
      masters: [E_LEFT, liar],
    });
    const result = buildFromSectionStructure(bundle, makeInput([6]));
    const pages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    // Парад слева + коллажи (Liar) — НЕ degrade.
    expect(masterNameById(bundle, pages[0]!.master_id)).toBe('E-Left');
    expect(masterNameById(bundle, pages[1]!.master_id)).toBe('Liar-Right');
    expect(
      result.warnings.some((w) => w.includes('students_multi_spread_no_collage_master')),
    ).toBe(false);
  });

  it('multi_spread без коллажных мастеров → degrade + warning, без падения', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          { type: 'students', config: { mode: 'multi_spread', spreads_per_student: 3, quote: true } },
        ],
      }),
      masters: [E_LEFT, E_RIGHT_4], // E_RIGHT_4 с цитатой → не коллаж; коллажей нет
    });
    const result = buildFromSectionStructure(bundle, makeInput([12]));
    const pages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    expect(pages).toHaveLength(2); // парад слева + достроенная правая (degrade)
    expect(
      result.warnings.some((w) => w.includes('students_multi_spread_no_collage_master')),
    ).toBe(true);
  });

  it('multi_spread ВРУЧНУЮ: строит ровно заданную последовательность мастеров', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          {
            type: 'students',
            config: {
              mode: 'multi_spread',
              spreads_per_student: 2, // игнорируется в ручном
              quote: true,
              manual_pages: ['E-Left', 'Gallery-Right', 'Gallery-Left', 'Gallery-Right'],
            },
          },
        ],
      }),
      masters: [E_LEFT, GALLERY_LEFT, GALLERY_RIGHT],
    });
    const result = buildFromSectionStructure(bundle, makeInput([12]));
    const pages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    expect(pages).toHaveLength(4);
    const names = pages.map((p) => masterNameById(bundle, p!.master_id));
    expect(names).toEqual(['E-Left', 'Gallery-Right', 'Gallery-Left', 'Gallery-Right']);

    // Парад: портрет привязан. Фото текут со смещением по страницам.
    expect(pages[0]!.bindings.studentportrait_1).toBe('https://cdn/p0.jpg');
    expect(pages[1]!.bindings.studentphoto_1).toBe('https://cdn/p0_f0.jpg'); // offset 0
    expect(pages[2]!.bindings.studentphoto_1).toBe('https://cdn/p0_f4.jpg'); // offset 4
  });

  it('multi_spread ВРУЧНУЮ: неизвестный мастер → warning + страница пропущена', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [
          {
            type: 'students',
            config: {
              mode: 'multi_spread',
              spreads_per_student: 2,
              quote: true,
              manual_pages: ['E-Left', 'Nonexistent-Master'],
            },
          },
        ],
      }),
      masters: [E_LEFT, GALLERY_LEFT, GALLERY_RIGHT],
    });
    const result = buildFromSectionStructure(bundle, makeInput([4]));
    const pages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    expect(pages).toHaveLength(1); // только E-Left, отсутствующий пропущен
    expect(result.warnings.some((w) => w.includes('students_master_not_found'))).toBe(true);
  });

  it('grid per_page=16 → сетка на 16', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'students', config: { mode: 'grid', per_page: 16 } }],
      }),
      masters: [GRID_16],
    });
    const result = buildFromSectionStructure(bundle, makeInput(Array(16).fill(0)));
    const pages = result.spreads.flatMap((s) => [s.left, s.right].filter(Boolean));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.master_id).toBe('id-GRID-16');
    expect(pages[0]!.bindings.studentname_16).toBe('Student 15');
  });

  it('legacy: students без config → глобальные поля пресета (регресс)', () => {
    const bundle = makeBundle({
      preset: makePreset({
        id: 'p',
        student_layout_mode: 'spread',
        student_friend_photos: 4,
        student_has_quote: true,
        section_structure: [{ type: 'students' }], // нет config
      }),
      masters: [E_LEFT, E_RIGHT_2, E_RIGHT_3, E_RIGHT_4],
    });
    // Фиксированный режим: все ученики через student_friend_photos=4 → E-Right-4.
    const result = buildFromSectionStructure(bundle, makeInput([1, 2, 3]));
    const rights = result.spreads
      .map((s) => s.right)
      .filter(Boolean)
      .map((p) => masterNameById(bundle, p!.master_id));
    expect(rights).toEqual(['E-Right-4', 'E-Right-4', 'E-Right-4']);
  });

  it('сворачивание глобалок в config: legacy-пресет ≡ явный config', () => {
    const legacy = makeBundle({
      preset: makePreset({
        id: 'p',
        student_layout_mode: 'page',
        student_friend_photos: 0,
        student_has_quote: true,
        section_structure: [{ type: 'students' }],
      }),
      masters: [makePageMaster('left'), makePageMaster('right')],
    });
    const explicit = makeBundle({
      preset: makePreset({
        id: 'p',
        section_structure: [{ type: 'students', config: { mode: 'page', friends: 0, quote: true } }],
      }),
      masters: [makePageMaster('left'), makePageMaster('right')],
    });
    const a = buildFromSectionStructure(legacy, makeInput([0, 0]));
    const b = buildFromSectionStructure(explicit, makeInput([0, 0]));
    const ids = (r: typeof a) =>
      r.spreads.flatMap((s) => [s.left?.master_id, s.right?.master_id].filter(Boolean));
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a).length).toBe(2);
  });
});

// page-мастер: 1 ученик на страницу, портрет+имя+цитата.
function makePageMaster(side: 'left' | 'right'): SpreadTemplate {
  return makeMaster(
    `E-Page-${side}`,
    [photoSlot('studentportrait_1'), textSlot('studentname_1'), textSlot('studentquote_1')],
    side === 'left' ? 'student_left' : 'student_right',
    { students: 1, photos_friend: 0, has_quote: true, has_portrait: true, has_name: true },
  );
}
