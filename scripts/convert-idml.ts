/**
 * convert-idml.ts — CLI: parse IDML file → upload as template_set to Supabase.
 *
 * Запуск:
 *   npx tsx --env-file=.env.local scripts/convert-idml.ts <idml-path> [flags]
 *
 * Флаги — см. printUsage() ниже или запуск с --help.
 *
 * Поток:
 *   1) Парсит argv (минимальный walker, без commander/yargs).
 *   2) Парсит IDML через `parseIdml` из `lib/idml-converter/parse`.
 *   3) При --dry-run печатает план и выходит, не обращаясь к Supabase.
 *   4) Иначе динамически импортирует `supabaseAdmin` из `lib/supabase`
 *      (статический import упал бы — модуль кидает Error при отсутствии env)
 *      и вызывает `uploadTemplateSetToSupabase` из `lib/idml-converter/upload`.
 *
 * Детали вставки в БД (валидация, force-overwrite, rollback) — см. upload.ts.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseIdml } from '../lib/idml-converter/parse';
import { uploadTemplateSetToSupabase } from '../lib/idml-converter/upload';
import type { ParserWarning } from '../lib/idml-converter/types';

const SLUG_REGEX = /^[a-z0-9-]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParsedArgs = {
  idmlPath: string;
  name: string;
  slug: string;
  printType: 'layflat' | 'soft';
  tenantId: string | null;
  description: string | null;
  force: boolean;
  dryRun: boolean;
};

type ParseArgsResult =
  | { kind: 'help' }
  | { kind: 'config'; config: ParsedArgs }
  | { kind: 'error'; message: string };

function printUsage(): void {
  console.log(
    [
      'Usage: npx tsx --env-file=.env.local scripts/convert-idml.ts <idml-path> [flags]',
      '',
      'Required:',
      '  <idml-path>            Path to IDML file',
      '  --name "..."           Display name for template_sets.name',
      '  --slug "..."           URL slug, must match /^[a-z0-9-]+$/',
      '  --print-type T         Either "layflat" or "soft"',
      '',
      '  One of:',
      '    --global             Make it a global template (tenant_id=null)',
      '    --tenant-id <uuid>   Attach to specific tenant',
      '',
      'Optional:',
      '  --description "..."    Description',
      '  --force                Overwrite existing template_set with same slug',
      '  --dry-run              Parse and print plan, do not write to DB',
      '  --help                 Show this help',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): ParseArgsResult {
  let idmlPath: string | undefined;
  let name: string | undefined;
  let slug: string | undefined;
  let printType: string | undefined;
  let tenantId: string | undefined;
  let isGlobal = false;
  let description: string | null = null;
  let force = false;
  let dryRun = false;

  // Helper: читает следующий аргумент как значение флага.
  // Если следующий токен отсутствует или начинается с "--", считаем что
  // пользователь забыл значение → возвращаем ошибку.
  function readValue(flag: string, index: number): { value: string; nextIndex: number } | { error: string } {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      return { error: `${flag} requires a value` };
    }
    return { value, nextIndex: index + 2 };
  }

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      return { kind: 'help' };
    }

    if (arg === '--force') {
      force = true;
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      i += 1;
      continue;
    }
    if (arg === '--global') {
      isGlobal = true;
      i += 1;
      continue;
    }

    if (arg === '--name') {
      const r = readValue('--name', i);
      if ('error' in r) return { kind: 'error', message: r.error };
      name = r.value;
      i = r.nextIndex;
      continue;
    }
    if (arg === '--slug') {
      const r = readValue('--slug', i);
      if ('error' in r) return { kind: 'error', message: r.error };
      slug = r.value;
      i = r.nextIndex;
      continue;
    }
    if (arg === '--print-type') {
      const r = readValue('--print-type', i);
      if ('error' in r) return { kind: 'error', message: r.error };
      printType = r.value;
      i = r.nextIndex;
      continue;
    }
    if (arg === '--tenant-id') {
      const r = readValue('--tenant-id', i);
      if ('error' in r) return { kind: 'error', message: r.error };
      tenantId = r.value;
      i = r.nextIndex;
      continue;
    }
    if (arg === '--description') {
      const r = readValue('--description', i);
      if ('error' in r) return { kind: 'error', message: r.error };
      description = r.value;
      i = r.nextIndex;
      continue;
    }

    if (arg.startsWith('--')) {
      return { kind: 'error', message: `unknown flag "${arg}"` };
    }

    // Позиционный — путь к IDML, ровно один разрешён.
    if (idmlPath !== undefined) {
      return { kind: 'error', message: `unexpected extra positional argument "${arg}"` };
    }
    idmlPath = arg;
    i += 1;
  }

  // ─── Финальная валидация ───────────────────────────────────────
  if (!idmlPath) return { kind: 'error', message: '<idml-path> is required' };
  if (!name) return { kind: 'error', message: '--name is required' };
  if (!slug) return { kind: 'error', message: '--slug is required' };
  if (!SLUG_REGEX.test(slug)) {
    return { kind: 'error', message: `--slug "${slug}" must match /^[a-z0-9-]+$/` };
  }
  if (!printType) return { kind: 'error', message: '--print-type is required' };
  if (printType !== 'layflat' && printType !== 'soft') {
    return { kind: 'error', message: `--print-type must be "layflat" or "soft", got "${printType}"` };
  }
  if (isGlobal && tenantId !== undefined) {
    return { kind: 'error', message: 'use either --global or --tenant-id, not both' };
  }

  let resolvedTenantId: string | null;
  if (isGlobal) {
    resolvedTenantId = null;
  } else if (tenantId !== undefined) {
    if (!UUID_REGEX.test(tenantId)) {
      return { kind: 'error', message: `--tenant-id "${tenantId}" is not a valid UUID` };
    }
    resolvedTenantId = tenantId;
  } else {
    return { kind: 'error', message: 'either --global or --tenant-id is required' };
  }

  return {
    kind: 'config',
    config: {
      idmlPath,
      name,
      slug,
      printType,
      tenantId: resolvedTenantId,
      description,
      force,
      dryRun,
    },
  };
}

function formatWarning(w: ParserWarning): string {
  const parts: string[] = [];
  if (w.master) parts.push(`master "${w.master}"`);
  if (w.label) parts.push(`label "${w.label}"`);
  parts.push(w.message);
  return parts.join(': ');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.kind === 'help') {
    printUsage();
    return;
  }
  if (args.kind === 'error') {
    console.error('[error]', args.message);
    printUsage();
    process.exit(1);
  }

  const config = args.config;

  // ─── Проверка что IDML-файл существует ────────────────────────
  try {
    await fs.access(config.idmlPath);
  } catch {
    console.error(`[error] file not found: ${path.resolve(config.idmlPath)}`);
    process.exit(1);
  }

  // ─── Парсинг IDML ─────────────────────────────────────────────
  console.log(`[parse] Reading ${config.idmlPath}`);
  const buffer = await fs.readFile(config.idmlPath);
  const parsed = await parseIdml(buffer);
  console.log(
    `[parse] ${parsed.spread_templates.length} spread_templates, ` +
      `${parsed.page_width_mm}x${parsed.page_height_mm}mm, ` +
      `${parsed.warnings.length} warnings`,
  );

  // ─── Dry-run: печать плана без обращения к Supabase ───────────
  if (config.dryRun) {
    const totalPlaceholders = parsed.spread_templates.reduce(
      (sum, s) => sum + s.placeholders.length,
      0,
    );
    const scope = config.tenantId === null ? 'global' : `tenant ${config.tenantId}`;
    console.log('[dry-run] Plan:');
    console.log(`  slug:           ${config.slug}`);
    console.log(`  name:           ${config.name}`);
    console.log(`  print_type:     ${config.printType}`);
    console.log(`  scope:          ${scope}`);
    console.log(`  description:    ${config.description ?? '(none)'}`);
    console.log(`  force:          ${config.force}`);
    console.log(`  page size:      ${parsed.page_width_mm}x${parsed.page_height_mm} mm`);
    console.log(`  spread size:    ${parsed.spread_width_mm}x${parsed.spread_height_mm} mm`);
    console.log(`  bleed:          ${parsed.bleed_mm} mm`);
    console.log(`  facing_pages:   ${parsed.facing_pages}`);
    console.log(`  page_binding:   ${parsed.page_binding}`);
    console.log(`  spreads:        ${parsed.spread_templates.length}`);
    console.log(`  placeholders:   ${totalPlaceholders} (total across all spreads)`);
    console.log(`  warnings:       ${parsed.warnings.length}`);

    if (parsed.warnings.length > 0) {
      const shown = parsed.warnings.slice(0, 5);
      console.log('[dry-run] Warnings (first 5):');
      for (const w of shown) {
        console.log(`  - ${formatWarning(w)}`);
      }
      if (parsed.warnings.length > 5) {
        console.log(`  ...and ${parsed.warnings.length - 5} more`);
      }
    }
    return;
  }

  // ─── Реальный импорт: динамический import supabaseAdmin ───────
  // Статический import упал бы — lib/supabase.ts кидает Error
  // при отсутствии NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
  const { supabaseAdmin } = await import('../lib/supabase');

  const result = await uploadTemplateSetToSupabase(
    parsed,
    {
      name: config.name,
      slug: config.slug,
      tenantId: config.tenantId,
      printType: config.printType,
      description: config.description,
      force: config.force,
    },
    supabaseAdmin,
  );
  console.log(
    `[upload] Success: template_set_id=${result.template_set_id}, ` +
      `spread_count=${result.spread_count}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    if (err instanceof Error) {
      console.error('[error]', err.message);
    } else {
      console.error('[error] unknown error', err);
    }
    process.exit(1);
  });
