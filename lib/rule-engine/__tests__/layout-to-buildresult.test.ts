/**
 * Тесты adaptAlbumLayoutToBuildResult (РЭ.16.2).
 *
 * Покрывают конвертацию AlbumLayout (rule engine) → BuildResult (legacy).
 * Главные сценарии:
 *   - одиночные страницы (только left или только right)
 *   - left+right один мастер (типичный двухстраничный E-Standard / E-Max)
 *   - mixed_pages (разные мастера) → warning + берём левую
 *   - __master_name__ удаляется из data, остальные __X__ ключи остаются
 *   - missing master (__missing__/<name>) → skip + warning
 *   - status='failed' → throw (caller сделает fallback на legacy)
 *   - status='partial' → warning
 *   - warnings rule engine конвертируются в BuildWarning
 */

import { describe, it, expect } from 'vitest';
import { adaptAlbumLayoutToBuildResult } from '../layout-to-buildresult';
import type { AlbumLayout } from '../types';

function makeLayout(overrides: Partial<AlbumLayout>): AlbumLayout {
  return {
    spreads: [],
    decision_trace: [],
    rules_version: '1.0|test',
    preset_id: 'standard',
    status: 'ok',
    warnings: [],
    ...overrides,
  };
}

describe('adaptAlbumLayoutToBuildResult — basic mapping (1:N после РЭ.17.1)', () => {
  it('left+right разные мастера: 2 SpreadInstance с своими template_id', () => {
    // E-Standard-Left + E-Standard-Right — это ДВА мастера (по странице),
    // не один двухстраничный. Адаптер создаёт по SpreadInstance на каждый.
    const layout = makeLayout({
      spreads: [
        {
          spread_index: 0,
          left: {
            master_id: 'm-E-Standard-Left',
            bindings: {
              __master_name__: 'E-Standard-Left',
              studentportrait: 'A.jpg',
              studentname: 'Анна',
            },
          },
          right: {
            master_id: 'm-E-Standard-Right',
            bindings: {
              __master_name__: 'E-Standard-Right',
              studentportrait: 'B.jpg',
              studentname: 'Борис',
            },
          },
        },
      ],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    // 2 SpreadInstance — по странице
    expect(r.result.spreads.length).toBe(2);

    expect(r.result.spreads[0].spread_index).toBe(0);
    expect(r.result.spreads[0].template_id).toBe('m-E-Standard-Left');
    expect(r.result.spreads[0].template_name).toBe('E-Standard-Left');
    expect(r.result.spreads[0].data.studentportrait).toBe('A.jpg');
    expect(r.result.spreads[0].data.studentname).toBe('Анна');
    expect('__master_name__' in r.result.spreads[0].data).toBe(false);

    expect(r.result.spreads[1].spread_index).toBe(1);
    expect(r.result.spreads[1].template_id).toBe('m-E-Standard-Right');
    expect(r.result.spreads[1].template_name).toBe('E-Standard-Right');
    expect(r.result.spreads[1].data.studentportrait).toBe('B.jpg');
    expect(r.result.spreads[1].data.studentname).toBe('Борис');
  });

  it('is_spread=true (двухстраничный мастер): 1 SpreadInstance', () => {
    // J-Spread занимает оба листа — для legacy это один SpreadInstance.
    const layout = makeLayout({
      spreads: [
        {
          spread_index: 0,
          is_spread: true,
          left: {
            master_id: 'm-J-Spread',
            bindings: {
              __master_name__: 'J-Spread',
              spreadphoto: 'spread.jpg',
            },
          },
          right: {
            master_id: 'm-J-Spread',
            bindings: { __master_name__: 'J-Spread', spreadphoto: 'spread.jpg' },
          },
        },
      ],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    expect(r.result.spreads.length).toBe(1);
    expect(r.result.spreads[0].template_name).toBe('J-Spread');
  });

  it('одиночная страница только left → 1 SpreadInstance из left', () => {
    const layout = makeLayout({
      spreads: [
        {
          spread_index: 0,
          left: {
            master_id: 'm-F-Head-WithPhoto',
            bindings: {
              __master_name__: 'F-Head-WithPhoto',
              headteacherphoto: 'ht.jpg',
            },
          },
        },
      ],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    expect(r.result.spreads.length).toBe(1);
    expect(r.result.spreads[0].spread_index).toBe(0);
    expect(r.result.spreads[0].template_name).toBe('F-Head-WithPhoto');
    expect(r.result.spreads[0].data.headteacherphoto).toBe('ht.jpg');
  });

  it('одиночная страница только right → 1 SpreadInstance из right', () => {
    const layout = makeLayout({
      spreads: [
        {
          spread_index: 0,
          right: {
            master_id: 'm-J-Half',
            bindings: {
              __master_name__: 'J-Half',
              halfphoto_1: 'h1.jpg',
            },
          },
        },
      ],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    expect(r.result.spreads.length).toBe(1);
    expect(r.result.spreads[0].template_name).toBe('J-Half');
    expect(r.result.spreads[0].data.halfphoto_1).toBe('h1.jpg');
  });

  it('Сценарий «тест 2026» universal: 5 rule engine spreads → 10 legacy SpreadInstance', () => {
    // 1 учительский разворот (F-Head + G-HalfClass) + 4 пары учеников
    // (E-Universal-Left + E-Universal-Right) = 5 rule engine spreads,
    // но 10 legacy SpreadInstance (по 2 страницы каждый).
    const teacherSpread = {
      spread_index: 0,
      left: {
        master_id: 'm-F-Head-SmallGrid',
        bindings: { __master_name__: 'F-Head-SmallGrid', headteacherphoto: 'ht.jpg' },
      },
      right: {
        master_id: 'm-G-HalfClass',
        bindings: { __master_name__: 'G-HalfClass', halfphoto_1: 'h1.jpg' },
      },
    };
    const studentSpread = (idx: number) => ({
      spread_index: idx,
      left: {
        master_id: 'm-E-Universal-Left',
        bindings: {
          __master_name__: 'E-Universal-Left',
          studentportrait: `s${idx * 2 - 1}.jpg`,
        },
      },
      right: {
        master_id: 'm-E-Universal-Right',
        bindings: {
          __master_name__: 'E-Universal-Right',
          studentportrait: `s${idx * 2}.jpg`,
        },
      },
    });

    const layout = makeLayout({
      spreads: [teacherSpread, studentSpread(1), studentSpread(2), studentSpread(3), studentSpread(4)],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    expect(r.result.spreads.length).toBe(10);

    // Учитель занимает первые ДВЕ страницы (legacy spread_index 0 и 1)
    expect(r.result.spreads[0].template_name).toBe('F-Head-SmallGrid');
    expect(r.result.spreads[1].template_name).toBe('G-HalfClass');
    // Затем пара 1: E-Universal-Left + E-Universal-Right
    expect(r.result.spreads[2].template_name).toBe('E-Universal-Left');
    expect(r.result.spreads[3].template_name).toBe('E-Universal-Right');
    // И так далее
    expect(r.result.spreads[9].template_name).toBe('E-Universal-Right');

    // spread_index монотонно нарастает
    for (let i = 0; i < r.result.spreads.length; i++) {
      expect(r.result.spreads[i].spread_index).toBe(i);
    }
  });
});

describe('adaptAlbumLayoutToBuildResult — mixed_pages', () => {
  it('разные мастера слева и справа → 2 SpreadInstance + индекс в rules_meta', () => {
    // После РЭ.17.1 mixed_pages — нормальный случай: каждая страница
    // получает свой SpreadInstance, редактор рендерит их как соседние
    // страницы разворота. Warning 'mixed_pages_not_supported_by_editor'
    // больше не выдаётся (было неверным допущением).
    const layout = makeLayout({
      spreads: [
        {
          spread_index: 5,
          mixed_pages: true,
          left: {
            master_id: 'm-E-Standard-Left',
            bindings: {
              __master_name__: 'E-Standard-Left',
              studentportrait: 'last.jpg',
            },
          },
          right: {
            master_id: 'm-J-Half',
            bindings: {
              __master_name__: 'J-Half',
              halfphoto_1: 'common1.jpg',
              halfphoto_2: 'common2.jpg',
            },
          },
        },
      ],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    expect(r.result.spreads.length).toBe(2);

    expect(r.result.spreads[0].template_name).toBe('E-Standard-Left');
    expect(r.result.spreads[0].data.studentportrait).toBe('last.jpg');
    expect(r.result.spreads[1].template_name).toBe('J-Half');
    expect(r.result.spreads[1].data.halfphoto_1).toBe('common1.jpg');

    // Warning о mixed_pages БОЛЬШЕ НЕ ВЫДАЁТСЯ
    expect(
      r.result.warnings.find((x) =>
        x.detail.includes('разные мастера слева'),
      ),
    ).toBeUndefined();

    // Но индекс в rules_meta сохраняется (для audit_log)
    expect(r.rules_meta.mixed_pages_indices).toEqual([5]);
  });
});

describe('adaptAlbumLayoutToBuildResult — служебные ключи', () => {
  it('__hidden__X и __pos__X сохраняются (нужны для balance/PDF render)', () => {
    const layout = makeLayout({
      spreads: [
        {
          spread_index: 0,
          left: {
            master_id: 'm-G-Teachers-3x3',
            bindings: {
              __master_name__: 'G-Teachers-3x3',
              teacherphoto_1: 's1.jpg',
              teacherphoto_2: 's2.jpg',
              __hidden__teacherphoto_3: '1',
              __pos__teacherphoto_1: '20,30',
            },
          },
        },
      ],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    const d = r.result.spreads[0].data;
    expect(d.__hidden__teacherphoto_3).toBe('1');
    expect(d.__pos__teacherphoto_1).toBe('20,30');
    expect('__master_name__' in d).toBe(false);
  });

  it('null/undefined → null; number → "N"; boolean → "true"/"false"', () => {
    const layout = makeLayout({
      spreads: [
        {
          spread_index: 0,
          left: {
            master_id: 'm-X',
            bindings: {
              __master_name__: 'X',
              a: null,
              b: undefined,
              c: 42,
              d: true,
              e: 'string',
            },
          },
        },
      ],
    });

    const d = adaptAlbumLayoutToBuildResult(layout).result.spreads[0].data;
    expect(d.a).toBeNull();
    expect(d.b).toBeNull();
    expect(d.c).toBe('42');
    expect(d.d).toBe('true');
    expect(d.e).toBe('string');
  });
});

describe('adaptAlbumLayoutToBuildResult — missing master', () => {
  it('master_id __missing__/<name> → spread skipped + warning master_not_found', () => {
    const layout = makeLayout({
      spreads: [
        {
          spread_index: 0,
          left: {
            master_id: '__missing__/Z-DoesNotExist',
            bindings: { __master_name__: 'Z-DoesNotExist' },
          },
        },
      ],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    expect(r.result.spreads.length).toBe(0);
    expect(
      r.result.warnings.some((w) =>
        w.detail.includes('Z-DoesNotExist'),
      ),
    ).toBe(true);
  });
});

describe('adaptAlbumLayoutToBuildResult — статус', () => {
  it('status=ok → no дополнительный warning', () => {
    const layout = makeLayout({ status: 'ok', warnings: [] });
    const r = adaptAlbumLayoutToBuildResult(layout);
    expect(r.result.warnings.length).toBe(0);
    expect(r.rules_meta.status).toBe('ok');
  });

  it('status=partial → warning rule_engine_partial', () => {
    const layout = makeLayout({
      status: 'partial',
      warnings: ['something happened'],
    });
    const r = adaptAlbumLayoutToBuildResult(layout);
    // 1 warning из layout.warnings + 1 итоговый partial = 2
    expect(r.result.warnings.length).toBe(2);
    expect(
      r.result.warnings.some((w) => w.detail.includes('partial')),
    ).toBe(true);
    expect(
      r.result.warnings.some((w) => w.detail.includes('something happened')),
    ).toBe(true);
  });

  it('status=failed → throw', () => {
    const layout = makeLayout({
      status: 'failed',
      warnings: ['fatal: something bad'],
    });
    expect(() => adaptAlbumLayoutToBuildResult(layout)).toThrow(/rule engine failed/);
  });
});

describe('adaptAlbumLayoutToBuildResult — rules_meta', () => {
  it('сохраняет decision_trace + rules_version + total_spreads', () => {
    const layout = makeLayout({
      rules_version: 'v1.0|36|standard',
      decision_trace: [
        {
          spread_index: 0,
          section_index: 0,
          family_id: 'head-teacher',
          rule_id: 't-class-1-4-half',
          inputs: { subjects_count: 2 },
        },
      ],
      spreads: [
        {
          spread_index: 0,
          left: { master_id: 'm', bindings: { __master_name__: 'X' } },
        },
      ],
    });

    const r = adaptAlbumLayoutToBuildResult(layout);
    expect(r.rules_meta.rules_version).toBe('v1.0|36|standard');
    expect(r.rules_meta.decision_trace.length).toBe(1);
    expect(r.rules_meta.decision_trace[0].rule_id).toBe('t-class-1-4-half');
    expect(r.rules_meta.total_spreads).toBe(1);
    expect(r.rules_meta.mixed_pages_indices).toEqual([]);
  });
});
