/**
 * upload-test.ts — sanity-проверка lib/idml-converter/upload против реального
 * Supabase. Round-trip: parse IDML → upload → SELECT → cleanup.
 *
 * Поток:
 *   1. Pre-check: ищет старые test-import-* template_sets старше 1 часа.
 *      Если есть — WARN, не удаляет (могут принадлежать другому разработчику
 *      или другой ветке).
 *   2. Генерирует уникальный slug test-import-<Date.now()>.
 *   3. Парсит docs/templates/Плотные Мастер Белый.idml.
 *   4. Вызывает uploadTemplateSetToSupabase (tenantId=null, force=false).
 *   5. SELECT-проверки round-trip:
 *      - template_sets row существует, page_width_mm ≈ 226
 *      - slug / is_global / page_binding round-trip
 *      - 39 spread_templates rows
 *      - E-Student-Left присутствует, его placeholders[studentportrait].width_mm ≈ 115
 *   6. Cleanup в try/finally — всегда удаляет тестовую запись (best-effort,
 *      ошибки cleanup-а логирует, но не падает).
 *
 * Запуск из корня репо:
 *   npx tsx --env-file=.env.local scripts/dev/upload-test.ts
 *
 * Локальный отладочный скрипт. Не запускается в проде / на Vercel
 * (см. scripts/dev/README.md, .vercelignore).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parseIdml } from '../../lib/idml-converter/parse';
import { uploadTemplateSetToSupabase } from '../../lib/idml-converter/upload';
import { supabaseAdmin } from '../../lib/supabase';

const IDML_PATH = path.join(
  process.cwd(),
  'docs/templates/Плотные Мастер Белый.idml',
);

const TOLERANCE_MM = 0.1;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  const sign = ok ? '\x1b[32m[OK]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`  ${sign} ${label}${suffix}`);
  if (ok) passed++;
  else failed++;
}

function info(label: string, detail?: string): void {
  const sign = '\x1b[36m[INFO]\x1b[0m';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`  ${sign} ${label}${suffix}`);
}

function near(actual: number, expected: number, tol = TOLERANCE_MM): boolean {
  return Math.abs(actual - expected) <= tol;
}

async function main(): Promise<void> {
  console.log('\n=== upload-test: Supabase round-trip sanity ===\n');

  console.log('Pre-check stale test imports:');
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: stale, error: staleErr } = await supabaseAdmin
    .from('template_sets')
    .select('id, slug, created_at')
    .like('slug', 'test-import-%')
    .lt('created_at', oneHourAgo);

  if (staleErr) {
    info('pre-check query failed (continuing anyway)', staleErr.message);
  } else if (stale && stale.length > 0) {
    console.warn(`  [WARN] found ${stale.length} stale test-import-* template_sets older than 1h:`);
    for (const row of stale as Array<{ id: string; slug: string; created_at: string }>) {
      console.warn(`    - id=${row.id}, slug=${row.slug}, created_at=${row.created_at}`);
    }
    console.warn('  Please clean them up manually if they are not from another active test run.');
  } else {
    info('no stale test imports');
  }

  console.log('\nParsing IDML:');
  const buffer = await fs.readFile(IDML_PATH);
  const parsed = await parseIdml(buffer);
  info(`${parsed.spread_templates.length} spread_templates, ${parsed.warnings.length} warnings`);

  const slug = `test-import-${Date.now()}`;
  console.log(`\nUploading with slug=${slug}:`);

  let templateSetId: string | null = null;
  try {
    const result = await uploadTemplateSetToSupabase(
      parsed,
      { name: 'Test Import', slug, tenantId: null, printType: 'layflat', force: false },
      supabaseAdmin,
    );
    templateSetId = result.template_set_id;
    info(`upload returned template_set_id=${result.template_set_id}, spread_count=${result.spread_count}`);

    console.log('\nVerify template_sets row:');
    const { data: setRow, error: setErr } = await supabaseAdmin
      .from('template_sets')
      .select('id, page_width_mm, slug, is_global, facing_pages, page_binding')
      .eq('id', templateSetId)
      .maybeSingle<{
        id: string;
        page_width_mm: string | number;
        slug: string | null;
        is_global: boolean;
        facing_pages: boolean;
        page_binding: string;
      }>();

    if (setErr || !setRow) {
      check('template_set exists in DB', false, setErr?.message ?? 'no row returned');
    } else {
      check('template_set exists in DB', true);
      const pageWidth = Number(setRow.page_width_mm);
      check('page_width_mm ≈ 226 ±0.1', near(pageWidth, 226), `got ${pageWidth.toFixed(3)}`);
      check(`slug round-trips ("${slug}")`, setRow.slug === slug, `got ${setRow.slug}`);
      check('is_global === true', setRow.is_global === true, `got ${setRow.is_global}`);
      check(`page_binding === "${parsed.page_binding}"`, setRow.page_binding === parsed.page_binding, `got ${setRow.page_binding}`);
    }

    console.log('\nVerify spread_templates rows:');
    const { count: spreadCount, error: countErr } = await supabaseAdmin
      .from('spread_templates')
      .select('id', { count: 'exact', head: true })
      .eq('template_set_id', templateSetId);

    if (countErr) {
      check('spread_count === 39', false, countErr.message);
    } else {
      check('spread_count === 39', spreadCount === 39, `got ${spreadCount}`);
    }

    console.log('\nVerify E-Student-Left / studentportrait round-trip:');
    const { data: eStudent, error: esErr } = await supabaseAdmin
      .from('spread_templates')
      .select('name, placeholders')
      .eq('template_set_id', templateSetId)
      .eq('name', 'E-Student-Left')
      .maybeSingle<{
        name: string;
        placeholders: Array<{ label: string; width_mm: string | number }>;
      }>();

    if (esErr || !eStudent) {
      check('E-Student-Left found in spread_templates', false, esErr?.message ?? 'not found');
    } else {
      check('E-Student-Left found in spread_templates', true);
      const portrait = eStudent.placeholders.find((p) => p.label === 'studentportrait');
      if (!portrait) {
        const labels = eStudent.placeholders.map((p) => p.label).join(', ');
        check('studentportrait in placeholders', false, `labels: [${labels}]`);
      } else {
        check('studentportrait in placeholders', true);
        const w = Number(portrait.width_mm);
        check('studentportrait.width_mm ≈ 115 ±0.1', near(w, 115), `got ${w.toFixed(3)}`);
      }
    }
  } finally {
    if (templateSetId) {
      console.log('\nCleanup:');
      const { error: cleanupSpreadsErr } = await supabaseAdmin
        .from('spread_templates')
        .delete()
        .eq('template_set_id', templateSetId);
      if (cleanupSpreadsErr) {
        console.error(`  [cleanup] failed to delete spread_templates: ${cleanupSpreadsErr.message}`);
      }
      const { error: cleanupSetErr } = await supabaseAdmin
        .from('template_sets')
        .delete()
        .eq('id', templateSetId);
      if (cleanupSetErr) {
        console.error(`  [cleanup] failed to delete template_set: ${cleanupSetErr.message}`);
      }
      if (!cleanupSpreadsErr && !cleanupSetErr) {
        info(`removed test template_set ${templateSetId}`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('upload-test crashed:', err);
  process.exit(2);
});
