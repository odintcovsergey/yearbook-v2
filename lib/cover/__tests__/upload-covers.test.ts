import { describe, it, expect } from 'vitest';
import { coverSlug, deriveCoverType, buildCoverRow } from '../upload-covers';
import type { ParsedSpreadTemplate } from '../../idml-converter/types';

describe('coverSlug', () => {
  it('lowercase + дефисы', () => {
    expect(coverSlug('C-Cover-Portrait')).toBe('c-cover-portrait');
  });
  it('кириллица и спецсимволы → дефис', () => {
    expect(coverSlug('Обложка №1!')).toBe('1');
  });
  it('пустой → cover', () => {
    expect(coverSlug('!!!')).toBe('cover');
  });
});

describe('deriveCoverType', () => {
  it('по имени: portrait → portrait_photo', () => {
    expect(deriveCoverType('C-Cover-Portrait', []).cover_type).toBe('portrait_photo');
  });
  it('по имени: common → common_photo', () => {
    expect(deriveCoverType('C-Cover-Common', []).cover_type).toBe('common_photo');
  });
  it('по имени: design → design_only', () => {
    expect(deriveCoverType('C-Cover-Design', []).cover_type).toBe('design_only');
  });
  it('по меткам, если имя не ясно: cover_portrait → portrait_photo', () => {
    expect(deriveCoverType('C-Cover-X', [{ label: 'cover_portrait' }]).cover_type).toBe('portrait_photo');
  });
  it('по умолчанию design_only', () => {
    expect(deriveCoverType('C-Cover-X', [{ label: 'cover_title' }]).cover_type).toBe('design_only');
  });
  it('пол из имени', () => {
    expect(deriveCoverType('C-Cover-Design-Boys', []).gender_hint).toBe('boys');
    expect(deriveCoverType('C-Cover-Design-Девочки', []).gender_hint).toBe('girls');
    expect(deriveCoverType('C-Cover-Design-Neutral', []).gender_hint).toBe('neutral');
    expect(deriveCoverType('C-Cover-Portrait', []).gender_hint).toBeNull();
  });
});

function master(over?: Partial<ParsedSpreadTemplate>): ParsedSpreadTemplate {
  return {
    name: 'C-Cover-Portrait',
    type: 'cover',
    is_spread: false,
    width_mm: 420,
    height_mm: 288,
    placeholders: [{ label: 'cover_portrait' }] as never,
    rules: null,
    cover_zones: { back_width_mm: 200, spine_width_mm: 10, front_width_mm: 200 },
    ...over,
  };
}

describe('buildCoverRow', () => {
  it('глобальная обложка (tenantId null) → is_global true', () => {
    const row = buildCoverRow(master(), { tenantId: null });
    expect(row.is_global).toBe(true);
    expect(row.tenant_id).toBeNull();
    expect(row.template_set_id).toBeNull();
    expect(row.slug).toBe('c-cover-portrait');
    expect(row.cover_type).toBe('portrait_photo');
    expect(row.is_published).toBe(false);
  });

  it('зоны и номинальный корешок переносятся из cover_zones', () => {
    const row = buildCoverRow(master(), { tenantId: null });
    expect(row.back_width_mm).toBe(200);
    expect(row.front_width_mm).toBe(200);
    expect(row.nominal_spine_width_mm).toBe(10);
    expect(row.height_mm).toBe(288);
  });

  it('без зон (cover_zones null) → ширины null', () => {
    const row = buildCoverRow(master({ cover_zones: null }), { tenantId: null });
    expect(row.back_width_mm).toBeNull();
    expect(row.nominal_spine_width_mm).toBeNull();
    expect(row.height_mm).toBe(288); // высота из мастера всё равно есть
  });

  it('обложка тенанта → is_global false + tenant_id', () => {
    const row = buildCoverRow(master(), { tenantId: 'tid-1', isPublished: true });
    expect(row.is_global).toBe(false);
    expect(row.tenant_id).toBe('tid-1');
    expect(row.is_published).toBe(true);
  });
});
