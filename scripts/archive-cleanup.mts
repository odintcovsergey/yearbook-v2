/**
 * Жизненный цикл архива — обёртка-CLI чистильщика исходников (Фаза 3).
 *
 * БЕЗОПАСНОСТЬ ПО УМОЛЧАНИЮ: без флага запускается DRY-RUN (только считает,
 * НИЧЕГО не удаляет). Реальное удаление — ТОЛЬКО с явным флагом `--apply`.
 *
 *   # сухой прогон (по умолчанию) — печатает что удалилось бы, не трогает данные:
 *   node_modules/.bin/tsx scripts/archive-cleanup.mts
 *
 *   # реальное удаление (необратимо, живое хранилище Timeweb):
 *   node_modules/.bin/tsx scripts/archive-cleanup.mts --apply
 *
 *   # проба на одном/нескольких истёкших заказах (Фаза 5):
 *   node_modules/.bin/tsx scripts/archive-cleanup.mts --apply --only=<album_id>[,<id2>]
 *
 *   # переопределить срок (по умолчанию 90):
 *   node_modules/.bin/tsx scripts/archive-cleanup.mts --ttl-days=120
 *
 * Запускается под systemd (yearbook-cleanup.service) с тем же релизом и
 * .env.production, что и сайт. Логи — в stdout (journalctl) + audit_log.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { runCleanup } from '@/lib/archive-cleanup/run';

function arg(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function gb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(3) + ' ГБ';
}

async function main() {
  const apply = flag('apply'); // БЕЗ него — безопасный dry-run
  const dryRun = !apply;
  const ttlDays = arg('ttl-days') ? Number(arg('ttl-days')) : undefined;
  const onlyRaw = arg('only');
  const onlyAlbumIds = onlyRaw ? onlyRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  const stamp = new Date().toISOString();
  console.log(`[archive-cleanup] ${stamp}`);
  console.log(`  режим: ${dryRun ? 'DRY-RUN (ничего не удаляется)' : '🔴 APPLY — РЕАЛЬНОЕ УДАЛЕНИЕ'}`);
  if (ttlDays !== undefined) console.log(`  ttl_days: ${ttlDays}`);
  if (onlyAlbumIds) console.log(`  only: ${onlyAlbumIds.join(', ')}`);

  const report = await runCleanup(supabaseAdmin, { dryRun, ttlDays, onlyAlbumIds });

  console.log('');
  console.log(`  истёкших заказов с исходниками к удалению: ${report.albums.length}`);
  console.log(`  ключей-оригиналов: ${report.totalKeys}`);
  console.log(`  объём: ${gb(report.totalBytes)}`);
  console.log(`  исключено анти-шарингом (держит живой/клон): ${report.sharedSkipped}`);
  for (const a of report.albums) {
    console.log(`    • ${a.title || a.album_id} — ${a.keys} ключей, ${gb(a.bytes)}`);
  }

  if (!dryRun) {
    console.log('');
    console.log(
      `  ✅ удалено ключей: ${report.deleted?.keys ?? 0}, обнулено строк: ${report.deleted?.nulledRows ?? 0}, ошибок: ${report.deleted?.errors ?? 0}`,
    );
  } else {
    console.log('');
    console.log('  DRY-RUN — данные не тронуты. Для реального удаления добавьте --apply.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[archive-cleanup] ОШИБКА:', e);
    process.exit(1);
  });
