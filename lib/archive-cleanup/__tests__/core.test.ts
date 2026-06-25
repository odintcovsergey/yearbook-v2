import { describe, it, expect } from 'vitest';
import {
  isExpiredAlbum,
  computeDeletableOriginals,
  archiveLifecycleStatus,
  DEFAULT_TTL_DAYS,
  type AlbumLifecycle,
  type PhotoOriginalRef,
} from '../core';

const NOW = Date.parse('2026-06-25T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function alb(id: string, o: Partial<AlbumLifecycle> = {}): AlbumLifecycle {
  return { id, archived: true, archived_at: daysAgo(100), keep_originals_forever: false, originals_deleted_at: null, ...o };
}

describe('isExpiredAlbum', () => {
  it('архивный, дата 100д назад, ttl 90 → истёк', () => {
    expect(isExpiredAlbum(alb('a'), NOW)).toBe(true);
  });
  it('не архивный → нет', () => {
    expect(isExpiredAlbum(alb('a', { archived: false }), NOW)).toBe(false);
  });
  it('archived_at = null (бэкфилл) → НЕ истёк (защита 11 заказов)', () => {
    expect(isExpiredAlbum(alb('a', { archived_at: null }), NOW)).toBe(false);
  });
  it('в пределах 90д (30д назад) → нет', () => {
    expect(isExpiredAlbum(alb('a', { archived_at: daysAgo(30) }), NOW)).toBe(false);
  });
  it('keep_originals_forever → нет', () => {
    expect(isExpiredAlbum(alb('a', { keep_originals_forever: true }), NOW)).toBe(false);
  });
  it('уже почищен (originals_deleted_at задан) → нет', () => {
    expect(isExpiredAlbum(alb('a', { originals_deleted_at: daysAgo(1) }), NOW)).toBe(false);
  });
});

describe('computeDeletableOriginals', () => {
  it('истёкший заказ без шаринга → его оригиналы в списке', () => {
    const albums = [alb('exp')];
    const photos: PhotoOriginalRef[] = [
      { album_id: 'exp', original_path: 'yc:exp/originals/a.jpg' },
      { album_id: 'exp', original_path: 'yc:exp/originals/b.jpg' },
      { album_id: 'exp', original_path: null }, // без оригинала — игнор
    ];
    const r = computeDeletableOriginals(albums, photos, NOW);
    expect(r.keys.sort()).toEqual(['yc:exp/originals/a.jpg', 'yc:exp/originals/b.jpg']);
    expect(r.expiredAlbumIds).toEqual(['exp']);
    expect(r.sharedSkipped).toEqual([]);
  });

  it('keep_forever → пусто', () => {
    const r = computeDeletableOriginals([alb('a', { keep_originals_forever: true })], [{ album_id: 'a', original_path: 'yc:a/originals/x.jpg' }], NOW);
    expect(r.keys).toEqual([]);
  });

  it('не истёк (30д) → пусто', () => {
    const r = computeDeletableOriginals([alb('a', { archived_at: daysAgo(30) })], [{ album_id: 'a', original_path: 'yc:a/originals/x.jpg' }], NOW);
    expect(r.keys).toEqual([]);
  });

  it('archived_at = null → пусто (защита бэкфилла)', () => {
    const r = computeDeletableOriginals([alb('a', { archived_at: null })], [{ album_id: 'a', original_path: 'yc:a/originals/x.jpg' }], NOW);
    expect(r.keys).toEqual([]);
  });

  // ⭐ КЛЮЧЕВОЙ: анти-шаринг. БЕЗ фильтра protectedPaths общий ключ попал бы в keys
  // и сломал бы живой клон. Тест проверяет, что он исключён.
  it('АНТИ-ШАРИНГ: истёкший источник, общий оригинал держит ЖИВОЙ клон → ключ НЕ удаляется', () => {
    const albums = [
      alb('src'),                          // истёкший заказ-источник (как Тест 30)
      alb('clone', { archived: false }),   // живой клон (как Тест 13), ссылается на файлы src
    ];
    const photos: PhotoOriginalRef[] = [
      { album_id: 'src', original_path: 'yc:src/originals/shared.jpg' }, // делят оба
      { album_id: 'src', original_path: 'yc:src/originals/own.jpg' },    // только источник
      { album_id: 'clone', original_path: 'yc:src/originals/shared.jpg' }, // клон держит shared
    ];
    const r = computeDeletableOriginals(albums, photos, NOW);
    // удаляем ТОЛЬКО эксклюзивный оригинал источника
    expect(r.keys).toEqual(['yc:src/originals/own.jpg']);
    // общий с живым клоном — исключён (иначе сломали бы клон)
    expect(r.sharedSkipped).toEqual(['yc:src/originals/shared.jpg']);
    expect(r.keys).not.toContain('yc:src/originals/shared.jpg');
  });

  it('анти-шаринг учитывает архивный-в-окне как «живой» держатель', () => {
    const albums = [
      alb('src'),                                      // истёк
      alb('hold', { archived_at: daysAgo(10) }),       // архивный, но в пределах 90д → держит
    ];
    const photos: PhotoOriginalRef[] = [
      { album_id: 'src', original_path: 'yc:src/originals/shared.jpg' },
      { album_id: 'hold', original_path: 'yc:src/originals/shared.jpg' },
    ];
    const r = computeDeletableOriginals(albums, photos, NOW);
    expect(r.keys).toEqual([]); // shared держит заказ в окне → не удаляем
    expect(r.sharedSkipped).toEqual(['yc:src/originals/shared.jpg']);
  });

  it('два истёкших заказа делят оригинал → ключ удаляется (живой никто не держит)', () => {
    const albums = [alb('e1'), alb('e2')];
    const photos: PhotoOriginalRef[] = [
      { album_id: 'e1', original_path: 'yc:x/originals/s.jpg' },
      { album_id: 'e2', original_path: 'yc:x/originals/s.jpg' },
    ];
    const r = computeDeletableOriginals(albums, photos, NOW);
    expect(r.keys).toEqual(['yc:x/originals/s.jpg']);
    expect(r.sharedSkipped).toEqual([]);
  });

  it('TTL = DEFAULT_TTL_DAYS (90)', () => {
    expect(DEFAULT_TTL_DAYS).toBe(90);
  });
});

describe('archiveLifecycleStatus (UI, Фаза 4)', () => {
  it('archived_at=null (11 старых) → not_started, НЕ «через 90 дней»', () => {
    expect(archiveLifecycleStatus(alb('a', { archived_at: null }), NOW)).toEqual({ kind: 'not_started' });
  });
  it('архивный 10д назад → countdown 80', () => {
    expect(archiveLifecycleStatus(alb('a', { archived_at: daysAgo(10) }), NOW)).toEqual({ kind: 'countdown', daysLeft: 80 });
  });
  it('архивный только что → countdown 90', () => {
    expect(archiveLifecycleStatus(alb('a', { archived_at: daysAgo(0) }), NOW)).toEqual({ kind: 'countdown', daysLeft: 90 });
  });
  it('просрочен (100д) → countdown 0, не уходит в минус', () => {
    expect(archiveLifecycleStatus(alb('a', { archived_at: daysAgo(100) }), NOW)).toEqual({ kind: 'countdown', daysLeft: 0 });
  });
  it('keep_originals_forever → forever (важнее отсчёта)', () => {
    expect(archiveLifecycleStatus(alb('a', { keep_originals_forever: true }), NOW)).toEqual({ kind: 'forever' });
  });
  it('originals_deleted_at задан → deleted (терминальный факт, важнее всего)', () => {
    const at = daysAgo(1);
    expect(archiveLifecycleStatus(alb('a', { originals_deleted_at: at }), NOW)).toEqual({ kind: 'deleted', at });
  });
  it('не в архиве → not_archived', () => {
    expect(archiveLifecycleStatus(alb('a', { archived: false }), NOW)).toEqual({ kind: 'not_archived' });
  });
  it('deleted важнее forever (исходники физически удалены)', () => {
    const at = daysAgo(2);
    expect(archiveLifecycleStatus(alb('a', { keep_originals_forever: true, originals_deleted_at: at }), NOW)).toEqual({ kind: 'deleted', at });
  });
});
