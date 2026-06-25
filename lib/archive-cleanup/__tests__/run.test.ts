import { describe, it, expect, vi, beforeEach } from 'vitest';

// Хранилище мокаем: удаление всегда успешно, размер объекта — заглушка.
vi.mock('@/lib/storage', () => ({
  ycDelete: vi.fn(async () => {}),
  stripYcPrefix: (k: string) => k.replace(/^yc:/, ''),
}));
vi.mock('@/lib/storage-twc', () => ({
  twcStorage: { send: vi.fn(async () => ({ ContentLength: 100 })) },
}));

import { runCleanup } from '../run';

const NOW = Date.parse('2026-06-25T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

type Row = { id: string; album_id: string; original_path: string | null };

/**
 * Мини-мок supabase-js под ровно те цепочки, что зовёт run.ts.
 * `urlLimit` имитирует БАГ: .in() с пачкой длиннее лимита «проходит», но НИЧЕГО
 * не обновляет (как при упоре в лимит длины URL у PostgREST/nginx).
 * `errorOnUpdate` имитирует явную ошибку обновления.
 */
function fakeSupabase(
  albumRows: any[],
  photoRows: Row[],
  opts: { urlLimit?: number; errorOnUpdate?: boolean } = {},
) {
  const urlLimit = opts.urlLimit ?? 1000;
  const photos = photoRows.map((p) => ({ ...p }));
  const auditInserts: any[] = [];
  const albumUpdates: any[] = [];

  const client = {
    from(table: string) {
      if (table === 'albums') {
        return {
          select: () => ({ data: albumRows, error: null }),
          update: (vals: any) => ({
            eq: (_c: string, id: string) => {
              albumUpdates.push({ id, vals });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === 'photos') {
        return {
          select: () => ({
            not: () => ({ data: photos.filter((p) => p.original_path !== null), error: null }),
          }),
          update: (vals: any) => {
            let albumId: string | undefined;
            let chunk: string[] = [];
            const b: any = {
              eq: (_c: string, id: string) => {
                albumId = id;
                return b;
              },
              in: (_c: string, arr: string[]) => {
                chunk = arr;
                return b;
              },
              select: () => {
                if (opts.errorOnUpdate) {
                  return Promise.resolve({ data: null, error: { message: 'boom (имитация ошибки)' } });
                }
                if (chunk.length > urlLimit) {
                  // «прошло», но ничего не обновлено — точная имитация бага
                  return Promise.resolve({ data: [], error: null });
                }
                const affected = photos.filter(
                  (p) => p.album_id === albumId && p.original_path !== null && chunk.includes(p.original_path),
                );
                affected.forEach((p) => (p.original_path = vals.original_path));
                return Promise.resolve({ data: affected.map((p) => ({ id: p.id })), error: null });
              },
            };
            return b;
          },
        };
      }
      if (table === 'audit_log') {
        return {
          insert: (row: any) => {
            auditInserts.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  };

  return { client: client as any, photos, auditInserts, albumUpdates };
}

// Один истёкший заказ A с N собственными оригиналами (1 строка = 1 ключ).
function fixture(n: number) {
  const album = {
    id: 'A',
    title: 'Тест A',
    tenant_id: 't1',
    archived: true,
    archived_at: daysAgo(100),
    keep_originals_forever: false,
    originals_deleted_at: null,
  };
  const photos: Row[] = Array.from({ length: n }, (_, i) => ({
    id: `ph${i}`,
    album_id: 'A',
    original_path: `yc:A/originals/${i}.jpg`,
  }));
  return { album, photos };
}

describe('runCleanup — обнуление original_path (фикс бага пробы)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy: 120 ключей, пачки по 50 → обнулены ВСЕ строки, заказ помечен, audit записан', async () => {
    const { album, photos } = fixture(120);
    const fk = fakeSupabase([album], photos, { urlLimit: 1000 });

    const report = await runCleanup(fk.client, { dryRun: false, nowMs: NOW });

    expect(report.deleted).toEqual({ keys: 120, errors: 0, nulledRows: 120 });
    // ни одной висячей ссылки не осталось
    expect(fk.photos.filter((p) => p.original_path !== null)).toHaveLength(0);
    // заказ помечен почищенным + ровно одна запись аудита
    expect(fk.albumUpdates).toHaveLength(1);
    expect(fk.albumUpdates[0].id).toBe('A');
    expect(fk.auditInserts).toHaveLength(1);
    expect(fk.auditInserts[0].action).toBe('album.originals_autodeleted');
    expect(fk.auditInserts[0].meta.keys).toBe(120);
  });

  it('баг-сценарий: длинная пачка молча не обновляет → ловим рассинхрон и ПАДАЕМ (не глотаем)', async () => {
    const { album, photos } = fixture(120);
    // urlLimit 30: пачки по 50 «проходят», но ничего не обнуляют (как был баг)
    const fk = fakeSupabase([album], photos, { urlLimit: 30 });

    await expect(runCleanup(fk.client, { dryRun: false, nowMs: NOW })).rejects.toThrow(/рассинхрон обнуления/);
    // упали ДО пометки заказа — не пишем originals_deleted_at и audit при битом обнулении
    expect(fk.albumUpdates).toHaveLength(0);
    expect(fk.auditInserts).toHaveLength(0);
  });

  it('ошибка update НЕ проглатывается → исключение', async () => {
    const { album, photos } = fixture(60);
    const fk = fakeSupabase([album], photos, { errorOnUpdate: true });

    await expect(runCleanup(fk.client, { dryRun: false, nowMs: NOW })).rejects.toThrow(/упало/);
    expect(fk.auditInserts).toHaveLength(0);
  });

  it('dry-run ничего не удаляет и не обнуляет', async () => {
    const { album, photos } = fixture(120);
    const fk = fakeSupabase([album], photos);

    const report = await runCleanup(fk.client, { dryRun: true, nowMs: NOW });

    expect(report.deleted).toBeUndefined();
    expect(fk.photos.filter((p) => p.original_path !== null)).toHaveLength(120);
    expect(fk.albumUpdates).toHaveLength(0);
    expect(fk.auditInserts).toHaveLength(0);
  });
});
