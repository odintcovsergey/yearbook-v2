/**
 * Тесты prepareTemplateSetClone (РЭ.28.2).
 *
 * Покрывают:
 *  - идентичные размеры → plan с теми же значениями (через округление)
 *  - resize: scale_x/scale_y вычисляются и применяются к мастерам
 *  - blocked-аспект → throws
 *  - facing_pages=true: spread_width = page_width * 2
 *  - facing_pages=false: spread_width = page_width
 *  - bleed_mm: override / fallback / null
 *  - parent_template_set_id заполнен
 *  - is_global=false и slug=null у клона
 */

import { describe, it, expect } from 'vitest';
import { prepareTemplateSetClone, type CloneRequest } from '../prepare-clone';
import { MM_STEP } from '../constants';

const sampleSource = {
  source_template_set: {
    id: 'src-id-1',
    name: 'Стандарт А4',
    page_width_mm: 210,
    page_height_mm: 297,
    spread_width_mm: 420,
    spread_height_mm: 297,
    bleed_mm: 3,
    print_type: 'layflat',
    facing_pages: true,
    page_binding: 'left',
    description: 'Стандартный дизайн',
  },
  source_masters: [
    {
      name: 'F-Head-LargeGrid',
      width_mm: 226,
      height_mm: 288,
      placeholders: [
        {
          x_mm: 32.808,
          y_mm: 14.999,
          width_mm: 81.21,
          height_mm: 111.622,
          rotation_deg: 0,
          label: 'headteacherphoto',
          type: 'photo',
        },
      ],
      type: 'master',
      sort_order: 1,
    },
    {
      name: 'E-Student-Standard',
      width_mm: 226,
      height_mm: 288,
      placeholders: [
        {
          x_mm: 10,
          y_mm: 20,
          width_mm: 100,
          height_mm: 120,
          rotation_deg: 0,
          label: 'studentphoto',
          type: 'photo',
        },
      ],
      type: 'master',
      sort_order: 2,
    },
  ],
  new_name: 'Мой Стандарт 21×30',
  new_page_width_mm: 210,
  new_page_height_mm: 297,
};

describe('prepareTemplateSetClone (РЭ.28)', () => {
  it('идентичные размеры → plan со scale=1', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    expect(plan.resize_info.scale_x).toBe(1);
    expect(plan.resize_info.scale_y).toBe(1);
    expect(plan.resize_info.aspect_check.level).toBe('ok');
  });

  it('parent_template_set_id заполняется ID источника', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    expect(plan.new_template_set.parent_template_set_id).toBe('src-id-1');
  });

  it('is_global = false у клона', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    expect(plan.new_template_set.is_global).toBe(false);
  });

  it('slug = null у клона', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    expect(plan.new_template_set.slug).toBeNull();
  });

  it('print_type копируется из источника', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    expect(plan.new_template_set.print_type).toBe('layflat');
  });

  it('name берётся из request (с trim)', () => {
    const plan = prepareTemplateSetClone({
      ...sampleSource,
      new_name: '  Мой дизайн  ',
    });
    expect(plan.new_template_set.name).toBe('Мой дизайн');
  });

  it('пустой name → throw', () => {
    expect(() =>
      prepareTemplateSetClone({ ...sampleSource, new_name: '   ' }),
    ).toThrow(/new_name/);
  });

  it('resize: новые размеры применяются к мастерам', () => {
    const plan = prepareTemplateSetClone({
      ...sampleSource,
      new_page_width_mm: 420, // в 2 раза шире
      new_page_height_mm: 594, // в 2 раза выше
    });
    expect(plan.resize_info.scale_x).toBe(2);
    expect(plan.resize_info.scale_y).toBe(2);
    // Мастер должен удвоиться (с поправкой на округление до пикселя)
    const master = plan.new_masters[0];
    expect(master.width_mm).toBeGreaterThan(226 * 1.95);
    expect(master.height_mm).toBeGreaterThan(288 * 1.95);
  });

  it('resize: placeholder пересчитан внутри мастера', () => {
    const plan = prepareTemplateSetClone({
      ...sampleSource,
      new_page_width_mm: 420,
      new_page_height_mm: 594,
    });
    const ph = (plan.new_masters[0].placeholders as Array<{x_mm: number; width_mm: number}>)[0];
    expect(ph.x_mm).toBeGreaterThan(32.808 * 1.95);
    expect(ph.width_mm).toBeGreaterThan(81.21 * 1.95);
  });

  it('blocked-аспект → throw', () => {
    expect(() =>
      prepareTemplateSetClone({
        ...sampleSource,
        new_page_width_mm: 210,
        new_page_height_mm: 100, // совсем другая пропорция
      }),
    ).toThrow(/aspect/);
  });

  it('facing_pages=true: spread_width = page_width * 2 (с округлением)', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    // page = 210, spread = ~420
    expect(plan.new_template_set.spread_width_mm).toBeGreaterThan(419);
    expect(plan.new_template_set.spread_width_mm).toBeLessThan(421);
    expect(plan.new_template_set.spread_height_mm).toBeGreaterThan(296);
    expect(plan.new_template_set.spread_height_mm).toBeLessThan(298);
  });

  it('facing_pages=false: spread_width = page_width', () => {
    const plan = prepareTemplateSetClone({
      ...sampleSource,
      source_template_set: {
        ...sampleSource.source_template_set,
        facing_pages: false,
      },
    });
    expect(plan.new_template_set.spread_width_mm).toBeGreaterThan(209);
    expect(plan.new_template_set.spread_width_mm).toBeLessThan(211);
  });

  it('bleed_mm: undefined → берём из source', () => {
    const plan = prepareTemplateSetClone(sampleSource); // new_bleed_mm не задан
    expect(plan.new_template_set.bleed_mm).not.toBeNull();
    expect(plan.new_template_set.bleed_mm).toBeGreaterThan(2.9);
    expect(plan.new_template_set.bleed_mm).toBeLessThan(3.1);
  });

  it('bleed_mm: явный null → null в клоне', () => {
    const plan = prepareTemplateSetClone({
      ...sampleSource,
      new_bleed_mm: null,
    });
    expect(plan.new_template_set.bleed_mm).toBeNull();
  });

  it('bleed_mm: явный override → используется (с округлением)', () => {
    const plan = prepareTemplateSetClone({
      ...sampleSource,
      new_bleed_mm: 5,
    });
    expect(plan.new_template_set.bleed_mm).toBeGreaterThan(4.9);
    expect(plan.new_template_set.bleed_mm).toBeLessThan(5.1);
  });

  it('resize_info.masters_count корректен', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    expect(plan.resize_info.masters_count).toBe(2);
  });

  it('resize_info.placeholders_resized корректен', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    expect(plan.resize_info.placeholders_resized).toBe(2); // по 1 в каждом мастере
  });

  it('размеры ≤ 0 → throw', () => {
    expect(() =>
      prepareTemplateSetClone({
        ...sampleSource,
        new_page_width_mm: 0,
        new_page_height_mm: 297,
      }),
    ).toThrow(/target page sizes/);
  });

  it('source с нулевыми размерами → throw', () => {
    expect(() =>
      prepareTemplateSetClone({
        ...sampleSource,
        source_template_set: {
          ...sampleSource.source_template_set,
          page_width_mm: 0,
        },
      }),
    ).toThrow(/source page sizes/);
  });

  it('мастер без placeholders → не падает, ph_count=0', () => {
    const plan = prepareTemplateSetClone({
      ...sampleSource,
      source_masters: [
        {
          ...sampleSource.source_masters[0],
          placeholders: [],
        },
      ],
    });
    expect(plan.resize_info.placeholders_resized).toBe(0);
    expect(plan.new_masters[0].placeholders).toEqual([]);
  });

  it('доп.поля мастера (sort_order, type) копируются', () => {
    const plan = prepareTemplateSetClone(sampleSource);
    expect(plan.new_masters[0].sort_order).toBe(1);
    expect(plan.new_masters[0].type).toBe('master');
  });
});
