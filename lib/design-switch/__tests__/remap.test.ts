import { describe, it, expect } from 'vitest';
import { remapAlbumSpreads, type SavedSpread } from '../remap';
import type { Placeholder, SlotCapacity, SpreadTemplate, PageRole, MasterType } from '@/lib/album-builder/types';

function photo(label: string): Placeholder {
  return { type: 'photo', label, x_mm: 0, y_mm: 0, width_mm: 50, height_mm: 60, fit: 'fill_proportional', required: false } as unknown as Placeholder;
}
function text(label: string): Placeholder {
  return {
    type: 'text', label, x_mm: 0, y_mm: 0, width_mm: 80, height_mm: 12,
    font_family: 'PT Serif', font_size_pt: 18, font_weight: 'regular', color: '#222', align: 'center', vertical_align: 'middle', auto_fit: false,
  } as unknown as Placeholder;
}

function master(
  id: string,
  pageRole: PageRole | null,
  slotCapacity: SlotCapacity | null,
  placeholders: Placeholder[],
  type: MasterType = 'student',
): SpreadTemplate {
  return {
    id, name: id, type, is_spread: false, width_mm: 200, height_mm: 280,
    placeholders, rules: null, sort_order: 0, applies_to_configs: [], default_for_configs: [],
    page_role: pageRole, slot_capacity: slotCapacity, is_fallback: false, mirror_for_soft: false, audit_notes: null,
  };
}

describe('remapAlbumSpreads', () => {
  it('переносит контент и кропы, но СБРАСЫВАЕТ стили и балансировку', () => {
    const cur = master('E-Left', 'student_left', { students: 1, has_portrait: true, has_name: true }, [
      photo('studentportrait_1'),
      text('studentname_1'),
    ]);
    const tgt = master('X-Left', 'student_left', { students: 1, has_portrait: true, has_name: true }, [
      photo('studentportrait_1'),
      text('studentname_1'),
    ]);
    const spread: SavedSpread = {
      spread_index: 0,
      template_id: 'E-Left',
      template_name: 'E-Left',
      section_type: 'students',
      data: {
        studentportrait_1: 'https://x/photo.webp',
        studentname_1: 'Иванова, Мария',
        __scale__studentportrait_1: '1.25',
        __offset__studentportrait_1: '5,10',
        __rotate__studentportrait_1: '3',
        __fontSize__studentname_1: '1.3', // стиль — НЕ переносим
        __color__studentname_1: '#ff0000', // стиль — НЕ переносим
        __pos__studentportrait_1: '12,34', // геометрия старого мастера — НЕ переносим
      },
    };

    const r = remapAlbumSpreads([spread], new Map([['E-Left', cur]]), [tgt]);
    expect(r.unmappable).toEqual([]);
    expect(r.perSpread[0].status).toBe('remapped');
    expect(r.perSpread[0].toMaster).toBe('X-Left');

    const d = r.newSpreads[0].data;
    // мастер сменился
    expect(r.newSpreads[0].template_id).toBe('X-Left');
    expect(r.newSpreads[0].template_name).toBe('X-Left');
    // контент перенесён
    expect(d.studentportrait_1).toBe('https://x/photo.webp');
    expect(d.studentname_1).toBe('Иванова, Мария');
    // кропы перенесены
    expect(d.__scale__studentportrait_1).toBe('1.25');
    expect(d.__offset__studentportrait_1).toBe('5,10');
    expect(d.__rotate__studentportrait_1).toBe('3');
    // стили СБРОШЕНЫ (возьмутся из нового дизайна)
    expect(d.__fontSize__studentname_1).toBeUndefined();
    expect(d.__color__studentname_1).toBeUndefined();
    // __pos__ (смещение рамки старого мастера) СБРОШЕН
    expect(d.__pos__studentportrait_1).toBeUndefined();
  });

  it('сохраняет __hidden__ (скрытые пустые слоты не вылезают после смены дизайна)', () => {
    // Сетка на 6, заполнены 4 ученика, слоты 5-6 пустые и скрыты.
    const ph = [photo('studentportrait_5'), text('studentname_5'), photo('studentportrait_6'), text('studentname_6')];
    const cur = master('L-6', 'student_grid', { students: 6 }, ph);
    const tgt = master('G-6', 'student_grid', { students: 6 }, ph);
    const spread: SavedSpread = {
      spread_index: 0,
      template_id: 'L-6',
      data: {
        studentportrait_5: null,
        studentname_5: null,
        __hidden__studentportrait_5: '1',
        __hidden__studentname_5: '1',
        __hidden__studentportrait_6: '1',
        __pos__studentportrait_5: '9,9', // должен отвалиться
      },
    };
    const r = remapAlbumSpreads([spread], new Map([['L-6', cur]]), [tgt]);
    const d = r.newSpreads[0].data;
    // скрытие сохранено
    expect(d.__hidden__studentportrait_5).toBe('1');
    expect(d.__hidden__studentname_5).toBe('1');
    expect(d.__hidden__studentportrait_6).toBe('1');
    // __pos__ всё равно сброшен
    expect(d.__pos__studentportrait_5).toBeUndefined();
  });

  it('переносит по другому label (BY_TYPE) — контент и кроп едут на новый слот', () => {
    const cur = master('Old', 'student_left', { students: 1, has_portrait: true }, [photo('studentphoto_old')]);
    const tgt = master('New', 'student_left', { students: 1, has_portrait: true }, [photo('studentportrait_1')]);
    const spread: SavedSpread = {
      spread_index: 0, template_id: 'Old', data: { studentphoto_old: 'url', __scale__studentphoto_old: '2' },
    };
    const r = remapAlbumSpreads([spread], new Map([['Old', cur]]), [tgt]);
    const d = r.newSpreads[0].data;
    expect(d.studentportrait_1).toBe('url');
    expect(d.__scale__studentportrait_1).toBe('2');
  });

  it('нет подходящего мастера → unmappable, разворот не тронут', () => {
    const cur = master('L-6', 'student_grid', { students: 6 }, [photo('studentportrait_1')]);
    const tgt = master('G-4', 'student_grid', { students: 4 }, [photo('studentportrait_1')]);
    const spread: SavedSpread = { spread_index: 2, template_id: 'L-6', data: { studentportrait_1: 'url' } };
    const r = remapAlbumSpreads([spread], new Map([['L-6', cur]]), [tgt]);
    expect(r.unmappable).toEqual([2]);
    expect(r.perSpread[0].status).toBe('unmappable');
    expect(r.newSpreads[0].template_id).toBe('L-6'); // не тронут
  });

  it('неизвестный мастер текущего разворота → unverified, не тронут', () => {
    const tgt = master('New', 'student_left', { students: 1 }, [photo('studentportrait_1')]);
    const spread: SavedSpread = { spread_index: 0, template_id: 'НЕТ', data: { studentportrait_1: 'url' } };
    const r = remapAlbumSpreads([spread], new Map(), [tgt]);
    expect(r.perSpread[0].status).toBe('unverified');
    expect(r.newSpreads[0].template_id).toBe('НЕТ');
    expect(r.unmappable).toEqual([]);
  });
});
