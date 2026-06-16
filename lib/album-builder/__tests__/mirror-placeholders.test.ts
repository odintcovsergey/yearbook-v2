import { describe, it, expect } from 'vitest';
import {
  mirrorPlaceholders,
  resolvePlaceholdersForSide,
} from '../mirror-placeholders';
import type {
  PhotoPlaceholder,
  TextPlaceholder,
  DecorationPlaceholder,
  RenderPlaceholder,
} from '../types';

function photo(over: Partial<PhotoPlaceholder> & { label: string }): PhotoPlaceholder {
  return {
    type: 'photo',
    x_mm: 0,
    y_mm: 0,
    width_mm: 40,
    height_mm: 40,
    fit: 'fill_proportional',
    required: false,
    ...over,
  };
}

function text(over: Partial<TextPlaceholder> & { label: string }): TextPlaceholder {
  return {
    type: 'text',
    x_mm: 0,
    y_mm: 0,
    width_mm: 40,
    height_mm: 10,
    font_family: 'Noto Serif',
    font_size_pt: 12,
    font_weight: 'regular',
    color: '#000000',
    align: 'center',
    vertical_align: 'middle',
    auto_fit: false,
    ...over,
  };
}

function decor(
  over: Partial<DecorationPlaceholder> & { label: string },
): DecorationPlaceholder {
  return {
    type: 'decoration',
    x_mm: 0,
    y_mm: 0,
    width_mm: 40,
    height_mm: 40,
    attached_to: '',
    layer: 'under',
    url: 'https://example/d.png',
    offset_x_mm: 0,
    offset_y_mm: 0,
    ...over,
  };
}

const PAGE_W = 208;

describe('mirrorPlaceholders', () => {
  it('отражает x_mm: x=10,w=40 при page_width=208 → x=158', () => {
    const [out] = mirrorPlaceholders([photo({ label: 'p', x_mm: 10, width_mm: 40 })], PAGE_W);
    expect(out.x_mm).toBe(158); // 208 - 10 - 40
  });

  it('y_mm / width_mm / height_mm неизменны', () => {
    const [out] = mirrorPlaceholders(
      [photo({ label: 'p', x_mm: 10, y_mm: 33, width_mm: 40, height_mm: 55 })],
      PAGE_W,
    );
    expect(out.y_mm).toBe(33);
    expect(out.width_mm).toBe(40);
    expect(out.height_mm).toBe(55);
  });

  it('rotation_deg меняет знак', () => {
    const [out] = mirrorPlaceholders(
      [photo({ label: 'p', rotation_deg: 90 })],
      PAGE_W,
    );
    expect(out.rotation_deg).toBe(-90);
  });

  it('rotation_deg отсутствует → остаётся undefined', () => {
    const [out] = mirrorPlaceholders([photo({ label: 'p' })], PAGE_W);
    expect(out.rotation_deg).toBeUndefined();
  });

  it("align 'left'→'right', 'right'→'left'", () => {
    const out = mirrorPlaceholders(
      [text({ label: 'l', align: 'left' }), text({ label: 'r', align: 'right' })],
      PAGE_W,
    ) as TextPlaceholder[];
    expect(out[0].align).toBe('right');
    expect(out[1].align).toBe('left');
  });

  it("align 'center'/'justify' без изменений", () => {
    const out = mirrorPlaceholders(
      [text({ label: 'c', align: 'center' }), text({ label: 'j', align: 'justify' })],
      PAGE_W,
    ) as TextPlaceholder[];
    expect(out[0].align).toBe('center');
    expect(out[1].align).toBe('justify');
  });

  it('vertical_align / шрифт / размер / цвет не трогаются', () => {
    const [out] = mirrorPlaceholders(
      [text({ label: 't', align: 'left', vertical_align: 'bottom', color: '#ff0000', font_size_pt: 18 })],
      PAGE_W,
    ) as TextPlaceholder[];
    expect(out.vertical_align).toBe('bottom');
    expect(out.color).toBe('#ff0000');
    expect(out.font_size_pt).toBe(18);
  });

  it('photo: fit / is_circle / corner / glow не трогаются', () => {
    const [out] = mirrorPlaceholders(
      [photo({ label: 'p', fit: 'contain', is_circle: true, corner_radius_mm: 3, glow_size_pt: 5, glow_color: '#fff' })],
      PAGE_W,
    ) as PhotoPlaceholder[];
    expect(out.fit).toBe('contain');
    expect(out.is_circle).toBe(true);
    expect(out.corner_radius_mm).toBe(3);
    expect(out.glow_size_pt).toBe(5);
    expect(out.glow_color).toBe('#fff');
  });

  it('привязанный декор __under: offset пересчитан, декор над тем же (зеркальным) слотом', () => {
    // База слот: x=10,w=40 → mirror x=158. Декор: x=8,w=44 (на 2мм левее и шире
    // базы) → mirror x = 208-8-44 = 156. Новый offset = 156-158 = -2.
    const input: RenderPlaceholder[] = [
      photo({ label: 'studentportrait_1', x_mm: 10, width_mm: 40 }),
      decor({ label: '__under_1', x_mm: 8, width_mm: 44, attached_to: 'studentportrait_1', offset_x_mm: -2, offset_y_mm: 1 }),
    ];
    const out = mirrorPlaceholders(input, PAGE_W);
    const base = out.find((p) => p.label === 'studentportrait_1')!;
    const d = out.find((p) => p.label === '__under_1') as DecorationPlaceholder;
    expect(base.x_mm).toBe(158);
    expect(d.x_mm).toBe(156);
    expect(d.offset_x_mm).toBe(d.x_mm - base.x_mm); // -2
    expect(d.offset_y_mm).toBe(1); // y-offset не трогаем
  });

  it('foreground-декор (attached_to=""): offset не трогается, x_mm отражается', () => {
    const [out] = mirrorPlaceholders(
      [decor({ label: '__fg_1', x_mm: 10, width_mm: 40, attached_to: '', layer: 'foreground', offset_x_mm: 7, offset_y_mm: 9 })],
      PAGE_W,
    ) as DecorationPlaceholder[];
    expect(out.x_mm).toBe(158);
    expect(out.offset_x_mm).toBe(7); // не пересчитан
    expect(out.offset_y_mm).toBe(9);
  });

  it('не мутирует вход', () => {
    const input = [photo({ label: 'p', x_mm: 10, width_mm: 40 })];
    const snapshot = JSON.parse(JSON.stringify(input));
    mirrorPlaceholders(input, PAGE_W);
    expect(input).toEqual(snapshot);
  });

  it('симметричный мастер: зеркало = no-op по координатам', () => {
    // Слот ровно по центру: x=84,w=40 → 208-84-40 = 84.
    const [out] = mirrorPlaceholders([photo({ label: 'p', x_mm: 84, width_mm: 40 })], PAGE_W);
    expect(out.x_mm).toBe(84);
  });
});

describe('resolvePlaceholdersForSide', () => {
  const phs: RenderPlaceholder[] = [photo({ label: 'p', x_mm: 10, width_mm: 40 })];

  it("right + page-any → зеркалит", () => {
    const out = resolvePlaceholdersForSide(phs, 'right', 'page-any', PAGE_W);
    expect(out[0].x_mm).toBe(158);
    expect(out).not.toBe(phs); // новый массив
  });

  it("left + page-any → как есть (та же ссылка)", () => {
    const out = resolvePlaceholdersForSide(phs, 'left', 'page-any', PAGE_W);
    expect(out).toBe(phs);
  });

  it("right + page-right → НЕ зеркалит (явный правый победил)", () => {
    const out = resolvePlaceholdersForSide(phs, 'right', 'page-right', PAGE_W);
    expect(out).toBe(phs);
  });

  it("right + page-left → НЕ зеркалит", () => {
    const out = resolvePlaceholdersForSide(phs, 'right', 'page-left', PAGE_W);
    expect(out).toBe(phs);
  });

  it("spread → НЕ зеркалит", () => {
    const out = resolvePlaceholdersForSide(phs, 'spread', 'page-any', PAGE_W);
    expect(out).toBe(phs);
  });

  it("page_type null/undefined → НЕ зеркалит", () => {
    expect(resolvePlaceholdersForSide(phs, 'right', null, PAGE_W)).toBe(phs);
    expect(resolvePlaceholdersForSide(phs, 'right', undefined, PAGE_W)).toBe(phs);
  });
});

describe('integration: page-any сетка слева vs справа', () => {
  // Реалистичный page-any мастер: 2 фото-слота смещены к корешку (внутреннему
  // краю), подпись и привязанный декор. На левой странице корешок справа
  // (внутренний край = правый), мастер нарисован под левую → контент у правого
  // края макета. Зеркало для правой страницы должно увести контент к левому
  // (= внутреннему для правой) краю.
  const master: RenderPlaceholder[] = [
    photo({ label: 'studentportrait_1', x_mm: 120, y_mm: 30, width_mm: 35, height_mm: 45 }),
    photo({ label: 'studentportrait_2', x_mm: 160, y_mm: 30, width_mm: 35, height_mm: 45 }),
    text({ label: 'studentname_1', x_mm: 120, y_mm: 78, width_mm: 35, height_mm: 8, align: 'left' }),
    decor({ label: '__over_1', x_mm: 118, y_mm: 28, width_mm: 39, height_mm: 49, attached_to: 'studentportrait_1', layer: 'over', offset_x_mm: -2, offset_y_mm: -2 }),
  ];

  it('левая страница — координаты как нарисованы (та же ссылка)', () => {
    const left = resolvePlaceholdersForSide(master, 'left', 'page-any', PAGE_W);
    expect(left).toBe(master);
  });

  it('правая страница — координаты зеркальны', () => {
    const right = resolvePlaceholdersForSide(master, 'right', 'page-any', PAGE_W);
    const p1 = right.find((p) => p.label === 'studentportrait_1')!;
    const p2 = right.find((p) => p.label === 'studentportrait_2')!;
    const name = right.find((p) => p.label === 'studentname_1') as TextPlaceholder;
    const d = right.find((p) => p.label === '__over_1') as DecorationPlaceholder;
    // x → 208 - x - w
    expect(p1.x_mm).toBe(208 - 120 - 35); // 53
    expect(p2.x_mm).toBe(208 - 160 - 35); // 13
    // y/размеры неизменны
    expect(p1.y_mm).toBe(30);
    expect(p1.width_mm).toBe(35);
    // align подписи перевернулся
    expect(name.align).toBe('right');
    // декор остался приклеен к зеркальному слоту
    expect(d.x_mm).toBe(208 - 118 - 39); // 51
    expect(d.offset_x_mm).toBe(d.x_mm - p1.x_mm); // 51 - 53 = -2
    expect(d.offset_y_mm).toBe(-2);
  });
});
