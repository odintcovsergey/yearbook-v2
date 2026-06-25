/**
 * Жизненный цикл архива — загрузчик/исполнитель чистильщика (Фаза 2).
 *
 * `runCleanup({ dryRun: true })`  → ТОЛЬКО считает (заказы / ключи / объём),
 *                                   НИЧЕГО не удаляет и не пишет.
 * `runCleanup({ dryRun: false })` → удаляет файлы-оригиналы из Timeweb
 *                                   (ycDelete → twcDelete, правильный путь, НЕ
 *                                   Supabase API), обнуляет photos.original_path,
 *                                   ставит albums.originals_deleted_at, пишет
 *                                   audit_log. Вызывается ТОЛЬКО из планировщика
 *                                   (Фаза 3) или вручную в пробе (Фаза 5).
 *
 * Логика отбора — чистое ядро core.ts (анти-шаринг). Здесь только I/O.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { twcStorage } from '@/lib/storage-twc';
import { ycDelete, stripYcPrefix } from '@/lib/storage';
import {
  computeDeletableOriginals,
  DEFAULT_TTL_DAYS,
  type AlbumLifecycle,
  type PhotoOriginalRef,
} from './core';

export interface CleanupAlbumLine {
  album_id: string;
  title: string;
  keys: number;
  bytes: number;
}

export interface CleanupReport {
  dryRun: boolean;
  ttlDays: number;
  /** Истёкшие заказы с оригиналами к удалению. */
  albums: CleanupAlbumLine[];
  totalKeys: number;
  totalBytes: number;
  /** Сколько кандидатов исключено анти-шарингом (делит не-истёкший заказ). */
  sharedSkipped: number;
  /** Только для dryRun=false: реально удалено / ошибок. */
  deleted?: { keys: number; errors: number };
}

/** Размер объекта в Timeweb (для отчёта). 0 если нет/ошибка. */
async function objectSize(originalPath: string): Promise<number> {
  try {
    const r = await twcStorage.send(
      new HeadObjectCommand({ Bucket: process.env.TWC_S3_BUCKET, Key: stripYcPrefix(originalPath) }),
    );
    return r.ContentLength ?? 0;
  } catch {
    return 0;
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function runCleanup(
  supabase: SupabaseClient,
  opts: {
    dryRun: boolean;
    ttlDays?: number;
    /** Подмена «сейчас» (мс) — для тестов/симуляции. По умолчанию Date.now(). */
    nowMs?: number;
    /** Ограничить удаление подмножеством истёкших заказов (проба, Фаза 5). */
    onlyAlbumIds?: string[];
  },
): Promise<CleanupReport> {
  const ttlDays = opts.ttlDays ?? DEFAULT_TTL_DAYS;
  const nowMs = opts.nowMs ?? Date.now();

  const { data: albumRows } = await supabase
    .from('albums')
    .select('id, title, tenant_id, archived, archived_at, keep_originals_forever, originals_deleted_at');
  const { data: photoRows } = await supabase
    .from('photos')
    .select('album_id, original_path')
    .not('original_path', 'is', null);

  const albums: AlbumLifecycle[] = (albumRows ?? []) as AlbumLifecycle[];
  const photos: PhotoOriginalRef[] = (photoRows ?? []) as PhotoOriginalRef[];
  const titleById = new Map<string, string>();
  const tenantById = new Map<string, string | null>();
  for (const a of albumRows ?? []) {
    titleById.set((a as any).id, (a as any).title ?? '');
    tenantById.set((a as any).id, (a as any).tenant_id ?? null);
  }

  const res = computeDeletableOriginals(albums, photos, nowMs, ttlDays);

  // Проба (Фаза 5): сузить до подмножества истёкших заказов.
  let byAlbum = res.byAlbum;
  if (opts.onlyAlbumIds && opts.onlyAlbumIds.length > 0) {
    const allow = new Set(opts.onlyAlbumIds);
    const filtered = new Map<string, string[]>();
    res.byAlbum.forEach((v, k) => { if (allow.has(k)) filtered.set(k, v); });
    byAlbum = filtered;
  }

  // Размеры (для отчёта) — параллельно, c ограничением.
  const keyArrays: string[][] = [];
  byAlbum.forEach((v) => keyArrays.push(v));
  const allKeys = Array.from(new Set(keyArrays.flat()));
  const sizes = await mapPool(allKeys, 8, objectSize);
  const sizeByKey = new Map<string, number>();
  allKeys.forEach((k, i) => sizeByKey.set(k, sizes[i]));

  const lines: CleanupAlbumLine[] = [];
  byAlbum.forEach((keys, album_id) => {
    lines.push({
      album_id,
      title: titleById.get(album_id) ?? '',
      keys: keys.length,
      bytes: keys.reduce((s: number, k: string) => s + (sizeByKey.get(k) ?? 0), 0),
    });
  });
  const totalKeys = allKeys.length;
  const totalBytes = lines.reduce((s, l) => s + l.bytes, 0);

  const report: CleanupReport = {
    dryRun: opts.dryRun,
    ttlDays,
    albums: lines,
    totalKeys,
    totalBytes,
    sharedSkipped: res.sharedSkipped.length,
  };

  if (opts.dryRun) return report;

  // ── Реальное удаление (только из планировщика/пробы) ────────────────────────
  let deletedKeys = 0;
  let errors = 0;
  for (const key of allKeys) {
    try {
      await ycDelete(key); // timeweb → twcDelete(stripYcPrefix(key)); правильный путь
      deletedKeys++;
    } catch {
      errors++;
    }
  }
  // Обнулить photos.original_path для удалённых ключей (чанками).
  for (let i = 0; i < allKeys.length; i += 200) {
    const chunk = allKeys.slice(i, i + 200);
    await supabase.from('photos').update({ original_path: null }).in('original_path', chunk);
  }
  // Отметить заказы как почищенные + audit_log.
  const nowIso = new Date(nowMs).toISOString();
  for (const [album_id, keys] of Array.from(byAlbum)) {
    await supabase.from('albums').update({ originals_deleted_at: nowIso }).eq('id', album_id);
    await supabase.from('audit_log').insert({
      tenant_id: tenantById.get(album_id) ?? null,
      user_id: null,
      action: 'album.originals_autodeleted',
      target_type: 'album',
      target_id: album_id,
      meta: { keys: keys.length, bytes: lines.find((l) => l.album_id === album_id)?.bytes ?? 0, ttl_days: ttlDays },
    });
  }

  report.deleted = { keys: deletedKeys, errors };
  return report;
}
