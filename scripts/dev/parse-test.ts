/**
 * Sanity-проверка `lib/idml-converter` против реального шаблона
 * `docs/templates/Плотные Мастер Белый.idml`.
 *
 * Эталонные значения — `docs/templates/idml-recon-notes.md` §2 и §3.
 *
 * Запуск из корня репо: `npx tsx scripts/dev/parse-test.ts`
 *
 * Локальный отладочный скрипт. Не запускается в проде / на Vercel
 * (см. `scripts/dev/README.md`, `.vercelignore`).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parseIdml } from '../../lib/idml-converter/parse';
import type { TextPlaceholder } from '../../lib/idml-converter/types';

const IDML_PATH = path.join(
  process.cwd(),
  'docs/templates/Плотные Мастер Белый.idml',
);

const TOLERANCE_MM = 0.1;

const EXPECTED_TWO_PAGE_MASTERS = [
  'E-Student-Default',
  'E-Student-Standard',
  'J-HalfSixth',
  'J-SixthFull',
  'J-SixthSixth',
  'S-Intro-Old',
];

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  const sign = ok ? '\x1b[32m[OK]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`  ${sign} ${label}${suffix}`);
  if (ok) passed++;
  else failed++;
}

function near(actual: number, expected: number, tol = TOLERANCE_MM): boolean {
  return Math.abs(actual - expected) <= tol;
}

const HEX_RE = /^#[0-9a-f]{6}$/;

function info(label: string, detail?: string): void {
  const sign = '\x1b[36m[INFO]\x1b[0m';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`  ${sign} ${label}${suffix}`);
}

async function main(): Promise<void> {
  const buffer = await fs.readFile(IDML_PATH);
  const result = await parseIdml(buffer);

  console.log('\n=== parse-test: lib/idml-converter sanity ===\n');
  console.log(
    `page_width_mm    = ${result.page_width_mm.toFixed(3)}  (expected ≈226)`,
  );
  console.log(
    `page_height_mm   = ${result.page_height_mm.toFixed(3)}  (expected ≈288)`,
  );
  console.log(
    `spread_templates = ${result.spread_templates.length}      (expected 39)`,
  );
  console.log(`warnings         = ${result.warnings.length}`);

  // ─── Базовая инфа ──────────────────────────────────────────────────────
  console.log('\nBasic:');
  check(
    'spread_templates.length === 39',
    result.spread_templates.length === 39,
    `got ${result.spread_templates.length}`,
  );
  check(
    'page_width_mm ≈ 226 ±0.1',
    near(result.page_width_mm, 226),
    `got ${result.page_width_mm.toFixed(3)}`,
  );
  check(
    'page_height_mm ≈ 288 ±0.1',
    near(result.page_height_mm, 288),
    `got ${result.page_height_mm.toFixed(3)}`,
  );

  // ─── Двухстраничные мастера ────────────────────────────────────────────
  console.log('\nTwo-page masters:');
  for (const name of EXPECTED_TWO_PAGE_MASTERS) {
    const master = result.spread_templates.find((s) => s.name === name);
    if (!master) {
      check(`${name} is_spread === true`, false, 'master not found');
      continue;
    }
    check(
      `${name} is_spread === true`,
      master.is_spread === true,
      `is_spread=${master.is_spread}`,
    );
  }

  // ─── Главный sanity-check: E-Student-Left / studentportrait ───────────
  // Эталон из recon-notes §3 (раздел «Эмпирическая проверка»).
  console.log('\nGeometry (E-Student-Left / studentportrait):');
  const eStudentLeft = result.spread_templates.find(
    (s) => s.name === 'E-Student-Left',
  );
  if (!eStudentLeft) {
    check('E-Student-Left present', false, 'master not found');
  } else {
    const portrait = eStudentLeft.placeholders.find(
      (p) => p.label === 'studentportrait',
    );
    if (!portrait) {
      const labels = eStudentLeft.placeholders.map((p) => p.label).join(', ');
      check(
        'studentportrait found',
        false,
        `labels in master: [${labels}]`,
      );
    } else {
      check(
        'studentportrait.x_mm ≈ 10.25 ±0.1',
        near(portrait.x_mm, 10.25),
        `got ${portrait.x_mm.toFixed(3)}`,
      );
      check(
        'studentportrait.y_mm ≈ 30.00 ±0.1',
        near(portrait.y_mm, 30.0),
        `got ${portrait.y_mm.toFixed(3)}`,
      );
      check(
        'studentportrait.width_mm ≈ 115 ±0.1',
        near(portrait.width_mm, 115),
        `got ${portrait.width_mm.toFixed(3)}`,
      );
      check(
        'studentportrait.height_mm ≈ 161 ±0.1',
        near(portrait.height_mm, 161),
        `got ${portrait.height_mm.toFixed(3)}`,
      );
    }
  }

  // ─── lowercase нормализация ───────────────────────────────────────────
  console.log('\nLowercase normalization:');
  const uppercaseLabels: Array<{ master: string; label: string }> = [];
  for (const master of result.spread_templates) {
    for (const ph of master.placeholders) {
      if (ph.label !== ph.label.toLowerCase()) {
        uppercaseLabels.push({ master: master.name, label: ph.label });
      }
    }
  }
  check(
    'all placeholder labels are lowercase',
    uppercaseLabels.length === 0,
    uppercaseLabels.length > 0
      ? `${uppercaseLabels.length} non-lowercase labels (e.g. ${uppercaseLabels[0].master}/${uppercaseLabels[0].label})`
      : undefined,
  );

  // ─── _left/_right суффиксы при коллизиях ──────────────────────────────
  console.log('\nDuplicate label suffixes:');
  for (const name of ['E-Student-Default', 'E-Student-Standard']) {
    const master = result.spread_templates.find((s) => s.name === name);
    if (!master) {
      check(`${name} has _left/_right suffixes`, false, 'master not found');
      continue;
    }
    const suffixed = master.placeholders.filter(
      (p) => p.label.endsWith('_left') || p.label.endsWith('_right'),
    );
    check(
      `${name} has _left/_right suffixes`,
      suffixed.length > 0,
      `${suffixed.length} suffixed labels`,
    );
  }

  // ─── Rotation в F-Head-WithPhoto ──────────────────────────────────────
  console.log('\nRotation:');
  const fHead = result.spread_templates.find(
    (s) => s.name === 'F-Head-WithPhoto',
  );
  if (!fHead) {
    check(
      'F-Head-WithPhoto has placeholder with rotation ≈ -90°',
      false,
      'master not found',
    );
  } else {
    const rotated = fHead.placeholders.find(
      (p) =>
        p.rotation_deg !== undefined &&
        p.rotation_deg > -91 &&
        p.rotation_deg < -89,
    );
    check(
      'F-Head-WithPhoto has placeholder with rotation ≈ -90°',
      !!rotated,
      rotated
        ? `${rotated.label} = ${rotated.rotation_deg?.toFixed(2)}°`
        : `${fHead.placeholders.length} placeholders, none rotated -90°`,
    );
  }

  // ─── Text styles ──────────────────────────────────────────────────────
  console.log('\nText styles:');
  const eslPlaceholders =
    result.spread_templates.find((s) => s.name === 'E-Student-Left')
      ?.placeholders ?? [];
  const studentNameRaw = eslPlaceholders.find(
    (p) => p.label === 'studentname',
  );
  if (!studentNameRaw || studentNameRaw.type !== 'text') {
    check(
      'E-Student-Left has studentname text placeholder',
      false,
      'not found or not text',
    );
  } else {
    const sn = studentNameRaw;
    info('studentname.font_family', sn.font_family);
    info('studentname.font_size_pt', String(sn.font_size_pt));
    check(
      'studentname.auto_fit === true',
      sn.auto_fit === true,
      `auto_fit=${sn.auto_fit}`,
    );
    check(
      'studentname.min_size_pt === 12',
      sn.min_size_pt === 12,
      `min_size_pt=${sn.min_size_pt}`,
    );
    check(
      'studentname.color is valid hex',
      HEX_RE.test(sn.color),
      `color=${sn.color}`,
    );
  }

  let foundQuote: { master: string; ph: TextPlaceholder } | null = null;
  for (const m of result.spread_templates) {
    for (const p of m.placeholders) {
      if (p.type === 'text' && p.label.includes('quote')) {
        foundQuote = { master: m.name, ph: p };
        break;
      }
    }
    if (foundQuote) break;
  }
  if (!foundQuote) {
    check('found a *quote* text placeholder', false, 'no quote in any master');
  } else {
    check(
      `${foundQuote.master}/${foundQuote.ph.label}.auto_fit === false`,
      foundQuote.ph.auto_fit === false,
      `auto_fit=${foundQuote.ph.auto_fit}`,
    );
  }

  // ─── Color validity ───────────────────────────────────────────────────
  console.log('\nColor validity:');
  const allTexts: Array<{ master: string; ph: TextPlaceholder }> = [];
  for (const m of result.spread_templates) {
    for (const p of m.placeholders) {
      if (p.type === 'text') allTexts.push({ master: m.name, ph: p });
    }
  }
  const emptyColor = allTexts.filter((t) => !t.ph.color);
  const invalidColor = allTexts.filter(
    (t) => t.ph.color && !HEX_RE.test(t.ph.color),
  );
  check(
    'no text placeholders with empty/undefined color',
    emptyColor.length === 0,
    `${emptyColor.length} empty (of ${allTexts.length} total)`,
  );
  check(
    'no text placeholders with invalid hex color',
    invalidColor.length === 0,
    invalidColor.length > 0
      ? `e.g. ${invalidColor[0].master}/${invalidColor[0].ph.label}=${invalidColor[0].ph.color}`
      : `${allTexts.length} text placeholders, all valid`,
  );

  // ─── Stories actually parsed (защита от молчаливого fallback) ────────
  console.log('\nStories actually parsed:');
  const nonDefault = allTexts.find(
    (t) => t.ph.font_family !== 'Geologica' || t.ph.font_size_pt !== 14,
  );
  check(
    'at least one text placeholder has non-default style (Stories parsed)',
    !!nonDefault,
    nonDefault
      ? `${nonDefault.master}/${nonDefault.ph.label}: ${nonDefault.ph.font_family} ${nonDefault.ph.font_size_pt}pt`
      : 'all text placeholders use Geologica/14pt — Stories may not be parsed correctly',
  );

  // ─── Multiple paragraph styles (info) ─────────────────────────────────
  const multiParaWarnings = result.warnings.filter((w) =>
    w.message.includes('multiple paragraph styles'),
  );
  if (multiParaWarnings.length > 0) {
    console.log('\nMultiple paragraph styles (info):');
    for (const w of multiParaWarnings) {
      const ctx = [w.master, w.label].filter(Boolean).join('/');
      info(ctx || '(no context)', w.message);
    }
  }

  // ─── Warnings (информационно) ─────────────────────────────────────────
  if (result.warnings.length > 0) {
    console.log('\nWarnings (informational):');
    for (const w of result.warnings) {
      const ctx = [w.master, w.label].filter(Boolean).join('/');
      console.log(`  - ${w.message}${ctx ? ` (${ctx})` : ''}`);
    }
  }

  // ─── Финал ────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('parse-test crashed:', err);
  process.exit(2);
});
