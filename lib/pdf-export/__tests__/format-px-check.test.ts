import { describe, it, expect } from 'vitest';
import { checkFormatPx } from '../format-px-check';
import type { PrinterFormat } from '../../printers/types';

function fmt(opts: Partial<PrinterFormat>): PrinterFormat {
  return {
    id: 'f', name: '22x30', family: 'vertical_rect',
    page_w_mm: 220, page_h_mm: 300, spread_w_px: 0, spread_h_px: 0,
    work_w_mm: 0, work_h_mm: 0, bleed_mm: 5, safe_mm: 10, ...opts,
  };
}

/** Ожидаемые px разворота по формуле (для согласованности тестов). */
function expectedPx(pageW: number, pageH: number, bleed: number, dpi: number) {
  return {
    w: Math.round(((pageW * 2 + bleed * 2) * dpi) / 25.4),
    h: Math.round(((pageH + bleed * 2) * dpi) / 25.4),
  };
}

const base = {
  pageWidthMm: 220, pageHeightMm: 300, bleedMm: 5, dpi: 300,
  acceptMode: 'spread' as const, adapted: true,
};

describe('checkFormatPx', () => {
  it('расхождение → warning с обоими числами', () => {
    const exp = expectedPx(220, 300, 5, 300);
    const format = fmt({ spread_w_px: exp.w + 30, spread_h_px: exp.h + 30 });
    const w = checkFormatPx({ ...base, format });
    expect(w).not.toBeNull();
    expect(w!.code).toBe('format_px_mismatch');
    expect(w!.detail).toContain(`${exp.w + 30}×${exp.h + 30}px`); // эталон
    expect(w!.detail).toContain(`${exp.w}×${exp.h}px`); // вычисленное
    expect(w!.detail).toContain('300 dpi');
  });

  it('совпадение (в допуске ±1) → null', () => {
    const exp = expectedPx(220, 300, 5, 300);
    expect(checkFormatPx({ ...base, format: fmt({ spread_w_px: exp.w, spread_h_px: exp.h }) })).toBeNull();
    // ±1px на округление — тоже ок
    expect(checkFormatPx({ ...base, format: fmt({ spread_w_px: exp.w + 1, spread_h_px: exp.h - 1 }) })).toBeNull();
  });

  it('пустой эталон px (0, как у «Булгака») → пропуск (null)', () => {
    expect(checkFormatPx({ ...base, format: fmt({ spread_w_px: 0, spread_h_px: 0 }) })).toBeNull();
  });

  it('режим приёма page → пропуск (нет per-page эталона)', () => {
    const exp = expectedPx(220, 300, 5, 300);
    const format = fmt({ spread_w_px: exp.w + 99, spread_h_px: exp.h + 99 });
    expect(checkFormatPx({ ...base, acceptMode: 'page', format })).toBeNull();
  });

  it('адаптация не применилась → пропуск', () => {
    const exp = expectedPx(220, 300, 5, 300);
    const format = fmt({ spread_w_px: exp.w + 99, spread_h_px: exp.h + 99 });
    expect(checkFormatPx({ ...base, adapted: false, format })).toBeNull();
  });

  it('формат не выбран → null', () => {
    expect(checkFormatPx({ ...base, format: null })).toBeNull();
  });
});
