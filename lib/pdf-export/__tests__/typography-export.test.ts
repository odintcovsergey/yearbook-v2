/**
 * Smoke-тест end-to-end типографской выгрузки: реально прогоняем
 * exportAlbumTypography на минимальном альбоме (без фото/фонов — без сети),
 * проверяем что рендер не падает, файлы создаются с верными именами и каждый —
 * валидный PDF. Это страхует структурную логику (нарезка → рендер → нарезка на
 * файлы → имена), отрисовка плейсхолдеров покрыта общим PDF-путём.
 */

import { describe, it, expect } from 'vitest';
import { exportAlbumTypography } from '../index';
import type { AlbumExportInput, ExportProfile } from '../types';
import type {
  TemplateSet,
  SpreadTemplate,
  SpreadInstance,
  AlbumInput,
} from '@/lib/album-builder/types';

function tpl(id: string, isSpread = false): SpreadTemplate {
  return {
    id,
    name: id,
    type: 'student',
    is_spread: isSpread,
    width_mm: isSpread ? 452 : 226,
    height_mm: 288,
    placeholders: [], // пустые — blank-страница, без сети/sharp
    rules: {},
    sort_order: 0,
    page_role: null,
    background_override_url: null,
    page_type: null,
  } as unknown as SpreadTemplate;
}

function templateSet(): TemplateSet {
  return {
    id: 'ts',
    name: 'Test',
    slug: 'test',
    page_width_mm: 226,
    page_height_mm: 288,
    bleed_mm: 5,
    default_background_url: null,
    spine_margin_mm: null,
    format_family: null,
    spreads: [tpl('M-Std'), tpl('J-Spread', true)],
  } as unknown as TemplateSet;
}

function page(i: number, opts: { tpl?: string; personal?: number } = {}): SpreadInstance {
  return {
    spread_index: i,
    template_id: opts.tpl ?? 'M-Std',
    template_name: opts.tpl ?? 'M-Std',
    data: {},
    ...(opts.personal !== undefined
      ? { personal: { section_index: 0, student_index: opts.personal } }
      : {}),
  };
}

const profile: ExportProfile = {
  id: 'typography',
  tenant_id: null,
  slug: 'typography',
  name: 'Типография',
  is_default: false,
  purpose: 'typography',
  format: 'pdf',
  quality: 'high',
  include_bleed: true,
  color_mode: 'rgb',
  dpi: 300,
  jpeg_quality: 92,
  filename_template: '',
  pages_mode: 'all_common',
  target_size_mb: null,
  enabled: true,
  spread_export: false,
};

function input(spreads: SpreadInstance[]): AlbumExportInput {
  return {
    album: { id: 'a', name: 'Test', tenant_id: 't' },
    layout: { spreads, has_user_edits: false },
    templateSet: templateSet(),
    albumInput: {} as unknown as AlbumInput,
    originals: [],
    urlToFilename: {},
    profile,
    backgrounds: [],
    effectivePrintType: 'layflat',
  };
}

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF" сигнатура.
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

describe('exportAlbumTypography (smoke)', () => {
  it('разворотами: 4 общие страницы → 2 файла-разворота, валидные PDF', async () => {
    const res = await exportAlbumTypography(
      input([page(0), page(1), page(2), page(3)]),
      { acceptMode: 'spread', targetFormat: null },
    );
    expect(res.files.map((f) => f.name)).toEqual(['000-01', '000-02']);
    expect(res.totalSpreads).toBe(2);
    expect(res.adaptStatus).toBe('native');
    for (const f of res.files) {
      expect(f.ext).toBe('pdf');
      expect(isPdf(f.bytes)).toBe(true);
      expect(f.bytes.length).toBeGreaterThan(100);
    }
  });

  it('постранично: 4 страницы → 4 файла-страницы', async () => {
    const res = await exportAlbumTypography(
      input([page(0), page(1), page(2), page(3)]),
      { acceptMode: 'page', targetFormat: null },
    );
    expect(res.files.map((f) => f.name)).toEqual(['000-01', '000-02', '000-03', '000-04']);
    res.files.forEach((f) => expect(isPdf(f.bytes)).toBe(true));
  });

  it('is_spread-мастер: разворотами 1 файл, постранично 2 файла', async () => {
    const spread = await exportAlbumTypography(input([page(0, { tpl: 'J-Spread' })]), {
      acceptMode: 'spread',
      targetFormat: null,
    });
    expect(spread.files.map((f) => f.name)).toEqual(['000-01']);

    const pages = await exportAlbumTypography(input([page(0, { tpl: 'J-Spread' })]), {
      acceptMode: 'page',
      targetFormat: null,
    });
    expect(pages.files.map((f) => f.name)).toEqual(['000-01', '000-02']);
    pages.files.forEach((f) => expect(isPdf(f.bytes)).toBe(true));
  });

  it('нарезка per-student: общие в 000, личные в 00X — отдельные файлы', async () => {
    const res = await exportAlbumTypography(
      input([page(0), page(1), page(2, { personal: 0 }), page(3, { personal: 1 })]),
      { acceptMode: 'spread', targetFormat: null },
    );
    expect(res.hasPersonal).toBe(true);
    const names = res.files.map((f) => f.name);
    // 000 (общий разворот 0-1), 001 (ученик 0), 002 (ученик 1).
    expect(names).toContain('000-01');
    expect(names).toContain('001-01');
    expect(names).toContain('002-01');
    const byBook = res.files.reduce<Record<string, number>>((acc, f) => {
      acc[f.book_id] = (acc[f.book_id] ?? 0) + 1;
      return acc;
    }, {});
    expect(byBook['001']).toBe(1);
    expect(byBook['002']).toBe(1);
  });

  it('обложки рендерятся как файлы 000-00/00X-00, валидные PDF', async () => {
    const res = await exportAlbumTypography(input([page(0), page(1)]), {
      acceptMode: 'spread',
      targetFormat: null,
      coverUnits: [
        {
          file_name: '000-00',
          width_mm: 212,
          height_mm: 100,
          placeholders: [],
          data: {},
          background_url: null,
        },
        {
          file_name: '001-00',
          width_mm: 212,
          height_mm: 100,
          placeholders: [],
          data: {},
          background_url: null,
        },
      ],
    });
    expect(res.coverCount).toBe(2);
    const names = res.files.map((f) => f.name);
    expect(names).toContain('000-00');
    expect(names).toContain('001-00');
    // Обложки идут отдельными валидными PDF-файлами.
    for (const cn of ['000-00', '001-00']) {
      const f = res.files.find((x) => x.name === cn)!;
      expect(isPdf(f.bytes)).toBe(true);
    }
  });

  it('JPG-вывод: fileFormat=jpeg → файлы .jpg, валидные JPEG', async () => {
    const res = await exportAlbumTypography(input([page(0), page(1)]), {
      acceptMode: 'spread',
      targetFormat: null,
      fileFormat: 'jpeg',
      dpi: 150, // ниже для скорости теста
      jpegQuality: 85,
    });
    expect(res.fileFormat).toBe('jpeg');
    expect(res.files.length).toBe(1);
    for (const f of res.files) {
      expect(f.ext).toBe('jpg');
      expect(isJpeg(f.bytes)).toBe(true);
      expect(f.bytes.length).toBeGreaterThan(500);
    }
  }, 30000);

  it('адаптация под формат: совместимое семейство → adapted', async () => {
    const res = await exportAlbumTypography(input([page(0), page(1)]), {
      acceptMode: 'spread',
      targetFormat: {
        id: '20x28',
        name: '20x28',
        family: 'vertical_rect',
        page_w_mm: 200,
        page_h_mm: 280,
        spread_w_px: 0,
        spread_h_px: 0,
        work_w_mm: 190,
        work_h_mm: 270,
        bleed_mm: 3,
        safe_mm: 5,
      },
    });
    expect(res.adaptStatus).toBe('adapted');
    res.files.forEach((f) => expect(isPdf(f.bytes)).toBe(true));
  });
});
