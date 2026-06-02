import { describe, it, expect } from 'vitest';
import {
  resolveCoverForStudent,
  fillCoverData,
  assembleCovers,
  type CoverStudentInput,
  type CoverAssemblyConfig,
  type CoverSharedContent,
} from '../assemble';
import type { Cover, CoverType } from '../types';
import type { Placeholder } from '../../album-builder/types';

function ph(label: string): Placeholder {
  return { label } as unknown as Placeholder;
}

let coverSeq = 0;
function makeCover(opts: {
  id?: string;
  type: CoverType;
  sort?: number;
  labels?: string[];
  available?: boolean;
  name?: string;
}): Cover {
  coverSeq += 1;
  return {
    id: opts.id ?? `cover-${coverSeq}`,
    tenant_id: null,
    is_global: true,
    template_set_id: null,
    name: opts.name ?? `Cover ${coverSeq}`,
    slug: null,
    cover_type: opts.type,
    gender_hint: null,
    variant_label: null,
    back_width_mm: 200,
    front_width_mm: 200,
    height_mm: 280,
    placeholders: (opts.labels ?? ['cover_portrait', 'cover_title', 'cover_subtitle']).map(ph),
    background_url: null,
    is_published: true,
    sort_order: opts.sort ?? 0,
    created_at: '2026-06-02T00:00:00Z',
  };
}

function student(id: string, over?: Partial<CoverStudentInput>): CoverStudentInput {
  return {
    child_id: id,
    full_name: `Ученик ${id}`,
    class: '11А',
    album_portrait_url: `https://cdn/album-portrait-${id}.jpg`,
    cover_portrait_override_url: null,
    choice: null,
    ...over,
  };
}

const SHARED: CoverSharedContent = {
  title: 'Выпуск 11А',
  subtitle: '2026',
  spine_text: 'Выпуск 2026',
  common_photo_url: 'https://cdn/class.jpg',
  back_common_photo_url: null,
  back_logo_url: null,
  back_contacts: null,
};

describe('resolveCoverForStudent', () => {
  const portraitCover = makeCover({ id: 'p1', type: 'portrait_photo', sort: 0 });
  const designA = makeCover({ id: 'd1', type: 'design_only', sort: 1 });
  const designB = makeCover({ id: 'd2', type: 'design_only', sort: 0 });
  const library = [portraitCover, designA, designB];

  it('fixed: игнорирует выбор родителя, берёт дефолтный тип и мастер', () => {
    const config: CoverAssemblyConfig = {
      mode: 'fixed',
      default_type: 'portrait_photo',
      available_cover_ids: [],
      library,
    };
    const s = student('1', { choice: { cover_type: 'design_only', cover_id: 'd1' } });
    const r = resolveCoverForStudent(s, config);
    expect(r.type).toBe('portrait_photo');
    expect(r.cover?.id).toBe('p1');
  });

  it('parent_choice: уважает выбор варианта родителем', () => {
    const config: CoverAssemblyConfig = {
      mode: 'parent_choice',
      default_type: 'portrait_photo',
      available_cover_ids: [],
      library,
    };
    const s = student('1', { choice: { cover_type: 'design_only', cover_id: 'd1' } });
    const r = resolveCoverForStudent(s, config);
    expect(r.type).toBe('design_only');
    expect(r.cover?.id).toBe('d1');
  });

  it('дефолтный мастер выбирается по sort_order', () => {
    const config: CoverAssemblyConfig = {
      mode: 'default_editable',
      default_type: 'design_only',
      available_cover_ids: [],
      library,
    };
    // d2 имеет sort_order 0 < d1 → берётся d2
    const r = resolveCoverForStudent(student('1'), config);
    expect(r.cover?.id).toBe('d2');
  });

  it('невалидный выбор (не из available) откатывается на дефолт', () => {
    const config: CoverAssemblyConfig = {
      mode: 'parent_choice',
      default_type: 'design_only',
      available_cover_ids: ['d2'], // d1 недоступен
      library,
    };
    const s = student('1', { choice: { cover_type: 'design_only', cover_id: 'd1' } });
    const r = resolveCoverForStudent(s, config);
    expect(r.cover?.id).toBe('d2');
  });

  it('нет подходящего мастера в библиотеке → cover null', () => {
    const config: CoverAssemblyConfig = {
      mode: 'fixed',
      default_type: 'common_photo',
      available_cover_ids: [],
      library, // нет common_photo
    };
    const r = resolveCoverForStudent(student('1'), config);
    expect(r.cover).toBeNull();
    expect(r.type).toBe('common_photo');
  });
});

describe('fillCoverData', () => {
  const cover = makeCover({
    type: 'portrait_photo',
    labels: ['cover_portrait', 'cover_title', 'cover_subtitle', 'spine_text', 'back_logo'],
  });

  it('портрет: override побеждает альбомный портрет', () => {
    const s = student('1', { cover_portrait_override_url: 'https://cdn/override.jpg' });
    const data = fillCoverData(cover, 'portrait_photo', s, SHARED);
    expect(data.cover_portrait).toBe('https://cdn/override.jpg');
  });

  it('портрет: без override берётся альбомный портрет', () => {
    const data = fillCoverData(cover, 'portrait_photo', student('1'), SHARED);
    expect(data.cover_portrait).toBe('https://cdn/album-portrait-1.jpg');
  });

  it('для не-портретного типа cover_portrait пуст', () => {
    const data = fillCoverData(cover, 'design_only', student('1'), SHARED);
    expect(data.cover_portrait).toBeNull();
  });

  it('тексты и back_* раскладываются по меткам', () => {
    const data = fillCoverData(cover, 'portrait_photo', student('1'), SHARED);
    expect(data.cover_title).toBe('Выпуск 11А');
    expect(data.cover_subtitle).toBe('2026');
    expect(data.spine_text).toBe('Выпуск 2026');
    expect(data.back_logo).toBeNull();
  });

  it('cover=null → пустые данные', () => {
    expect(fillCoverData(null, 'portrait_photo', student('1'), SHARED)).toEqual({});
  });
});

describe('assembleCovers', () => {
  const library = [
    makeCover({ id: 'p1', type: 'portrait_photo' }),
    makeCover({ id: 'd1', type: 'design_only', labels: ['cover_title'] }),
  ];

  it('portrait_photo → по обложке на ученика со своим портретом', () => {
    const config: CoverAssemblyConfig = {
      mode: 'fixed',
      default_type: 'portrait_photo',
      available_cover_ids: [],
      library,
    };
    const out = assembleCovers([student('1'), student('2')], config, SHARED);
    expect(out).toHaveLength(2);
    expect(out[0].child_id).toBe('1');
    expect(out[0].data.cover_portrait).toBe('https://cdn/album-portrait-1.jpg');
    expect(out[1].data.cover_portrait).toBe('https://cdn/album-portrait-2.jpg');
  });

  it('fixed + design_only → одна общая обложка (child_id=null)', () => {
    const config: CoverAssemblyConfig = {
      mode: 'fixed',
      default_type: 'design_only',
      available_cover_ids: [],
      library,
    };
    const out = assembleCovers([student('1'), student('2')], config, SHARED);
    expect(out).toHaveLength(1);
    expect(out[0].child_id).toBeNull();
    expect(out[0].cover_id).toBe('d1');
    expect(out[0].data.cover_title).toBe('Выпуск 11А');
  });

  it('parent_choice + не-портрет → всё равно по ученику (смесь выборов)', () => {
    const config: CoverAssemblyConfig = {
      mode: 'parent_choice',
      default_type: 'design_only',
      available_cover_ids: [],
      library,
    };
    const students = [
      student('1'), // дефолт design_only
      student('2', { choice: { cover_type: 'portrait_photo', cover_id: 'p1' } }),
    ];
    const out = assembleCovers(students, config, SHARED);
    expect(out).toHaveLength(2);
    expect(out[0].cover_type).toBe('design_only');
    expect(out[1].cover_type).toBe('portrait_photo');
    expect(out[1].data.cover_portrait).toBe('https://cdn/album-portrait-2.jpg');
  });
});
