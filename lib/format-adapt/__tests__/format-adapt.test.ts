import { describe, it, expect } from 'vitest';
import type { SpreadTemplate, Placeholder } from '../../album-builder/types';
import type { PrinterFormat } from '../../printers/types';
import {
  computeFormatFamily,
  resolveDesignFamily,
  resolveFormat,
  resolveWorkZone,
  adaptTemplateToFormat,
  adaptCoverToFormat,
} from '../index';

// ─── Фикстуры ────────────────────────────────────────────────────────────────

function photo(label: string, x: number, y: number, w: number, h: number): Placeholder {
  return { label, type: 'photo', x_mm: x, y_mm: y, width_mm: w, height_mm: h, fit: 'fill_proportional', required: false };
}
function text(label: string, x: number, y: number, w: number, h: number, pt: number): Placeholder {
  return {
    label, type: 'text', x_mm: x, y_mm: y, width_mm: w, height_mm: h,
    font_family: 'Arial', font_size_pt: pt, font_weight: 'regular', color: '#000',
    align: 'left', vertical_align: 'top', auto_fit: false,
  };
}
function master(opts: Partial<SpreadTemplate> & Pick<SpreadTemplate, 'width_mm' | 'height_mm'>): SpreadTemplate {
  return {
    id: 'm', name: 'M', type: 'student', is_spread: false,
    placeholders: [], rules: null, sort_order: 0,
    applies_to_configs: [], default_for_configs: [], page_role: null,
    slot_capacity: null, is_fallback: false, mirror_for_soft: false, audit_notes: null,
    ...opts,
  };
}
function fmt(opts: Partial<PrinterFormat> & Pick<PrinterFormat, 'family' | 'page_w_mm' | 'page_h_mm'>): PrinterFormat {
  return {
    id: 'f', name: '21x30', spread_w_px: 0, spread_h_px: 0,
    work_w_mm: 0, work_h_mm: 0, bleed_mm: 3, safe_mm: 5, ...opts,
  };
}

// ─── Семейство ───────────────────────────────────────────────────────────────

describe('семейство пропорций', () => {
  it('computeFormatFamily: вертикальный / квадрат / горизонтальный', () => {
    expect(computeFormatFamily(205, 296)).toBe('vertical_rect');
    expect(computeFormatFamily(200, 200)).toBe('square');
    expect(computeFormatFamily(205, 200)).toBe('square'); // в пределах ±8%
    expect(computeFormatFamily(300, 200)).toBe('horizontal');
  });

  it('resolveDesignFamily: явное поле важнее расчёта', () => {
    // Пропорция вертикальная, но дизайнер пометил квадрат — берём явное.
    expect(resolveDesignFamily({ page_width_mm: 205, page_height_mm: 296, format_family: 'square' })).toBe('square');
    // Нет явного — считаем по пропорции.
    expect(resolveDesignFamily({ page_width_mm: 205, page_height_mm: 296 })).toBe('vertical_rect');
    expect(resolveDesignFamily({ page_width_mm: 205, page_height_mm: 296, format_family: null })).toBe('vertical_rect');
  });
});

// ─── resolveFormat ───────────────────────────────────────────────────────────

describe('resolveFormat', () => {
  const config = { sheet_types: [], formats: [fmt({ id: 'a', family: 'vertical_rect', page_w_mm: 210, page_h_mm: 300 })] };
  it('находит формат по id', () => {
    expect(resolveFormat(config, 'a')?.id).toBe('a');
  });
  it('null при отсутствии id / неизвестном id / пустых форматах', () => {
    expect(resolveFormat(config, null)).toBeNull();
    expect(resolveFormat(config, 'zzz')).toBeNull();
    expect(resolveFormat({ sheet_types: [] }, 'a')).toBeNull();
    expect(resolveFormat(null, 'a')).toBeNull();
  });
});

// ─── safe в work-зоне ─────────────────────────────────────────────────────────

describe('resolveWorkZone (safe → work)', () => {
  it('явный work>0 → он (приоритет над safe)', () => {
    expect(resolveWorkZone(200, 10, 190)).toBe(190);
  });
  it('work=0/пусто, safe>0 → page − 2×safe', () => {
    expect(resolveWorkZone(200, 10, 0)).toBe(180);
    expect(resolveWorkZone(200, 10, undefined)).toBe(180);
  });
  it('safe=0 и work=0 → page (без регрессии)', () => {
    expect(resolveWorkZone(200, 0, 0)).toBe(200);
    expect(resolveWorkZone(200, undefined, undefined)).toBe(200);
  });
});

describe('safe применяется в адаптации', () => {
  const source = { pageWidthMm: 200, pageHeightMm: 290, family: 'vertical_rect' as const };
  const m = master({ width_mm: 200, height_mm: 290, placeholders: [photo('p', 0, 0, 200, 290)] });

  it('safe>0, work=0 → масштаб от page−2×safe, контент отступает от края ровно на safe', () => {
    const f = fmt({ family: 'vertical_rect', page_w_mm: 200, page_h_mm: 290, safe_mm: 10, bleed_mm: 0 });
    const r = adaptTemplateToFormat(m, source, f);
    expect(r.status).toBe('adapted');
    // workW=180, workH=270 → s=min(180/200, 270/290)=0.9
    expect(r.scale).toBeCloseTo(0.9, 5);
    // плейсхолдер с краю (x=0) после центрирования отступает на safe=10мм
    const p = (r.template.placeholders as Placeholder[])[0];
    expect(p.x_mm).toBeCloseTo(10, 5);
  });

  it('safe=0 → прежнее поведение (масштаб 1, без отступа)', () => {
    const f = fmt({ family: 'vertical_rect', page_w_mm: 200, page_h_mm: 290, safe_mm: 0, bleed_mm: 0 });
    const r = adaptTemplateToFormat(m, source, f);
    expect(r.scale).toBeCloseTo(1, 5);
    const p = (r.template.placeholders as Placeholder[])[0];
    expect(p.x_mm).toBeCloseTo(0, 5);
  });

  it('обложка: safe тоже отступает от края', () => {
    const f = fmt({ family: 'vertical_rect', page_w_mm: 200, page_h_mm: 290, safe_mm: 10, bleed_mm: 0 });
    const r = adaptCoverToFormat(
      { backWidthMm: 200, frontWidthMm: 200, heightMm: 290, spineWidthMm: 8, family: 'vertical_rect',
        placeholders: [{ ...photo('bp', 0, 0, 200, 290), zone: 'back' } as Placeholder & { zone: 'back' }] },
      f,
    );
    expect(r.status).toBe('adapted');
    expect(r.scale).toBeCloseTo(0.9, 5); // s = min(180/200, 270/290)
  });
});

// ─── Адаптация ───────────────────────────────────────────────────────────────

describe('adaptTemplateToFormat', () => {
  const vSource = { pageWidthMm: 205, pageHeightMm: 296, family: 'vertical_rect' as const };

  it('формат не выбран → native, мастер не тронут', () => {
    const t = master({ width_mm: 205, height_mm: 296, placeholders: [photo('p', 10, 10, 50, 50)] });
    const r = adaptTemplateToFormat(t, vSource, null);
    expect(r.status).toBe('native');
    expect(r.template).toBe(t);
  });

  it('чужое семейство → incompatible, мастер как есть + предупреждение', () => {
    const t = master({ width_mm: 205, height_mm: 296, placeholders: [photo('p', 10, 10, 50, 50)] });
    const square = fmt({ id: 's', name: '20x20', family: 'square', page_w_mm: 200, page_h_mm: 200 });
    const r = adaptTemplateToFormat(t, vSource, square);
    expect(r.status).toBe('incompatible');
    expect(r.template).toBe(t); // не трогаем
    if (r.status === 'incompatible') {
      expect(r.warning).toContain('вертикальный');
      expect(r.warning).toContain('квадратный');
    }
  });

  it('то же семейство → uniform-масштаб по work-зоне + центрирование', () => {
    // Дизайн 205×296, формат 21×30 (страница 210×300, work 190×280).
    const t = master({ width_mm: 205, height_mm: 296, placeholders: [photo('p', 10, 10, 50, 50), text('t', 0, 0, 100, 20, 12)] });
    const f = fmt({ id: 'a', name: '21x30', family: 'vertical_rect', page_w_mm: 210, page_h_mm: 300, work_w_mm: 190, work_h_mm: 280 });
    const r = adaptTemplateToFormat(t, vSource, f);
    expect(r.status).toBe('adapted');
    if (r.status !== 'adapted') return;
    // s = min(190/205, 280/296) = 0.9268...
    const s = Math.min(190 / 205, 280 / 296);
    expect(r.scale).toBeCloseTo(s, 5);
    // Целевой холст = страница (не spread).
    expect(r.template.width_mm).toBeCloseTo(210, 5);
    expect(r.template.height_mm).toBeCloseTo(300, 5);
    // offX = (210 - 205*s)/2, offY = (300 - 296*s)/2.
    const offX = (210 - 205 * s) / 2;
    const offY = (300 - 296 * s) / 2;
    const p = r.template.placeholders[0];
    expect(p.x_mm).toBeCloseTo(offX + 10 * s, 4);
    expect(p.y_mm).toBeCloseTo(offY + 10 * s, 4);
    expect(p.width_mm).toBeCloseTo(50 * s, 4);
    expect(p.height_mm).toBeCloseTo(50 * s, 4);
    // Текст: кегль масштабируется.
    const txt = r.template.placeholders[1];
    if (txt.type === 'text') expect(txt.font_size_pt).toBeCloseTo(12 * s, 4);
  });

  it('то же семейство, другой формат (23×30) → другой масштаб', () => {
    const t = master({ width_mm: 205, height_mm: 296 });
    const f = fmt({ id: 'b', name: '23x30', family: 'vertical_rect', page_w_mm: 230, page_h_mm: 300, work_w_mm: 210, work_h_mm: 285 });
    const r = adaptTemplateToFormat(t, vSource, f);
    expect(r.status).toBe('adapted');
    if (r.status !== 'adapted') return;
    expect(r.scale).toBeCloseTo(Math.min(210 / 205, 285 / 296), 5);
    expect(r.template.width_mm).toBeCloseTo(230, 5);
  });

  it('spread-мастер: масштаб по странице, холст = 2 страницы', () => {
    const t = master({ width_mm: 410, height_mm: 296, is_spread: true, placeholders: [photo('p', 0, 0, 410, 296)] });
    const f = fmt({ id: 'a', name: '21x30', family: 'vertical_rect', page_w_mm: 210, page_h_mm: 300, work_w_mm: 190, work_h_mm: 280 });
    const r = adaptTemplateToFormat(t, vSource, f);
    expect(r.status).toBe('adapted');
    if (r.status !== 'adapted') return;
    // srcPage = 410/2 = 205. s = min(190/205, 280/296).
    expect(r.scale).toBeCloseTo(Math.min(190 / 205, 280 / 296), 5);
    expect(r.template.width_mm).toBeCloseTo(420, 5); // 2 страницы
    expect(r.template.height_mm).toBeCloseTo(300, 5);
  });

  it('work=0 и safe=0 → фолбэк на размеры страницы (чистый случай)', () => {
    const t = master({ width_mm: 205, height_mm: 296 });
    // safe=0 ВАЖНО: иначе work=page−2×safe (см. отдельные safe-тесты выше).
    const f = fmt({ id: 'a', name: '21x30', family: 'vertical_rect', page_w_mm: 210, page_h_mm: 300, safe_mm: 0 }); // work_w/h=0
    const r = adaptTemplateToFormat(t, vSource, f);
    expect(r.status).toBe('adapted');
    if (r.status !== 'adapted') return;
    // s = min(210/205, 300/296) — по странице, без падения на нуле.
    expect(r.scale).toBeCloseTo(Math.min(210 / 205, 300 / 296), 5);
  });
});

// ─── Адаптация обложки ───────────────────────────────────────────────────────

describe('adaptCoverToFormat', () => {
  type CP = Parameters<typeof adaptCoverToFormat>[0]['placeholders'][number]
  const backPhoto: CP = { label: 'b', type: 'photo', zone: 'back', x_mm: 10, y_mm: 20, width_mm: 50, height_mm: 60, fit: 'fill_proportional', required: false }
  const spineText: CP = { label: 's', type: 'text', zone: 'spine', x_mm: 100, y_mm: 0, width_mm: 10, height_mm: 300, font_family: 'A', font_size_pt: 12, font_weight: 'regular', color: '#000', align: 'center', vertical_align: 'top', auto_fit: false }
  const frontPhoto: CP = { label: 'f', type: 'photo', zone: 'front', x_mm: 110, y_mm: 20, width_mm: 50, height_mm: 60, fit: 'fill_proportional', required: false }
  // back=100, spine=10, front=100 → frontStartNative = 110.
  const input = { backWidthMm: 100, frontWidthMm: 100, heightMm: 300, spineWidthMm: 10, family: 'vertical_rect' as const, placeholders: [backPhoto, spineText, frontPhoto] }

  it('формат не выбран → native, как есть', () => {
    const r = adaptCoverToFormat(input, null)
    expect(r.status).toBe('native')
    expect(r.widthMm).toBe(210) // 100+10+100
    expect(r.placeholders).toBe(input.placeholders)
  })

  it('чужое семейство → incompatible + предупреждение', () => {
    const sq = fmt({ id: 's', name: '20x20', family: 'square', page_w_mm: 200, page_h_mm: 200 })
    const r = adaptCoverToFormat(input, sq)
    expect(r.status).toBe('incompatible')
    if (r.status === 'incompatible') expect(r.warning).toContain('квадратный')
  })

  it('адаптация: страницы под формат, корешок физический, центрирование', () => {
    // Формат: страница 90×300, work 80×270. s = min(80/100, 270/300) = 0.8.
    const f = fmt({ id: 'a', name: '21x30', family: 'vertical_rect', page_w_mm: 90, page_h_mm: 300, work_w_mm: 80, work_h_mm: 270 })
    const r = adaptCoverToFormat(input, f)
    expect(r.status).toBe('adapted')
    if (r.status !== 'adapted') return
    expect(r.scale).toBeCloseTo(0.8, 5)
    // Полная ширина = page_w + корешок + page_w = 90+10+90 = 190.
    expect(r.widthMm).toBeCloseTo(190, 5)
    expect(r.heightMm).toBeCloseTo(300, 5)
    const [b, sp, fr] = r.placeholders
    // back: offXback = (90 - 100*0.8)/2 = 5; offY = (300-300*0.8)/2 = 30.
    expect(b.x_mm).toBeCloseTo(5 + 10 * 0.8, 4)
    expect(b.y_mm).toBeCloseTo(30 + 20 * 0.8, 4)
    expect(b.width_mm).toBeCloseTo(50 * 0.8, 4)
    // spine: физический — x = page_w + (x - back) = 90 + 0 = 90; ширина не масштабируется.
    expect(sp.x_mm).toBeCloseTo(90, 4)
    expect(sp.width_mm).toBeCloseTo(10, 4)
    // front: newFrontStart=90+10=100; offXfront=(90-100*0.8)/2=5; (110-110)*0.8=0 → 105.
    expect(fr.x_mm).toBeCloseTo(105, 4)
    expect(fr.width_mm).toBeCloseTo(50 * 0.8, 4)
  })
})
