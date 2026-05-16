/**
 * Сидер для rule engine — читает JSON из docs/rule-engine-data/,
 * валидирует Zod-схемами, проверяет ссылочную целостность.
 *
 * Режимы:
 *   - без флагов → read-only валидация (как было в РЭ.3)
 *   - --write   → UPSERT семейств + правил + пресетов (РЭ.3.5 + РЭ.8)
 *
 * Порядок записи в --write режиме:
 *   1. template_families — сначала, потому что rules ссылается через FK
 *   2. rules               — после семейств (family_id FK satisfied)
 *   3. presets             — последними (parent_preset_id self-ref FK,
 *                            sections.family_id — логическая ссылка, не FK)
 *
 * Запуск:
 *   npx tsx scripts/seed-rule-engine.ts              # валидация
 *   npx tsx --env-file=.env.local \
 *     scripts/seed-rule-engine.ts --write            # запись в БД
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  TemplateFamilySchema,
  PresetSchema,
  RuleSchema,
  validateSectionParams,
} from '../lib/rule-engine/schemas';

const DATA_ROOT = join(process.cwd(), 'docs', 'rule-engine-data');

interface LoadedFile {
  filename: string;
  data: unknown;
}

/**
 * Загружает все *.json из subdir, рекурсивно обходит подкаталоги.
 * Для families/ и presets/ это не нужно (плоская структура), но в rules/
 * мы группируем по семействам: rules/head-teacher/*.json, rules/student-section/*.json
 * Возвращаемый filename — относительный путь от subdir (например 'head-teacher/t-class-0-base.json').
 */
function loadJsonDir(subdir: string): LoadedFile[] {
  const rootPath = join(DATA_ROOT, subdir);
  if (!existsSync(rootPath)) return [];

  const out: LoadedFile[] = [];
  function walk(dir: string, relPrefix: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const content = readFileSync(full, 'utf-8');
        out.push({ filename: rel, data: JSON.parse(content) });
      }
    }
  }
  walk(rootPath, '');
  return out;
}

interface ValidationStats {
  total: number;
  valid: number;
  errors: number;
}

async function main(): Promise<void> {
  const writeMode = process.argv.includes('--write');

  // eslint-disable-next-line no-console
  console.log('Reading rule engine data from:', DATA_ROOT);
  // eslint-disable-next-line no-console
  console.log(`Mode: ${writeMode ? 'WRITE (UPSERT families + rules + presets to Supabase)' : 'read-only validation'}`);

  let hasErrors = false;

  // ---------------------------------------------------------------------------
  // 1. Семейства
  // ---------------------------------------------------------------------------
  const familyFiles = loadJsonDir('families');
  const familyStats: ValidationStats = {
    total: familyFiles.length,
    valid: 0,
    errors: 0,
  };
  const validFamilies: string[] = [];
  const validFamilyData: Array<{
    id: string;
    display_name: string;
    aliases: string[];
    deprecated: boolean;
    version: string;
    tenant_id: string | null;
    params: Record<string, unknown>;
    density_config: Record<string, unknown> | null;
  }> = [];

  // eslint-disable-next-line no-console
  console.log(`\nFamilies: ${familyFiles.length} files`);

  for (const { filename, data } of familyFiles) {
    const result = TemplateFamilySchema.safeParse(data);
    if (result.success) {
      validFamilies.push(result.data.id);
      validFamilyData.push({
        id: result.data.id,
        display_name: result.data.display_name,
        aliases: result.data.aliases,
        deprecated: result.data.deprecated,
        version: result.data.version,
        tenant_id: result.data.tenant_id,
        params: result.data.params,
        density_config: result.data.density_config ?? null,
      });
      familyStats.valid += 1;
      // eslint-disable-next-line no-console
      console.log(`  OK  ${filename} -> ${result.data.id}`);
    } else {
      familyStats.errors += 1;
      hasErrors = true;
      // eslint-disable-next-line no-console
      console.error(`  ERR ${filename}: ${result.error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Правила (пока могут быть пусты — наполняются в РЭ.4-РЭ.7)
  // ---------------------------------------------------------------------------
  const ruleFiles = loadJsonDir('rules');
  const ruleStats: ValidationStats = {
    total: ruleFiles.length,
    valid: 0,
    errors: 0,
  };
  const validRuleData: Array<{
    id: string;
    family_id: string;
    family_version: string;
    priority: number;
    rule_json: unknown;
    tenant_id: string | null;
    enabled: boolean;
  }> = [];

  // eslint-disable-next-line no-console
  console.log(`\nRules: ${ruleFiles.length} files`);

  for (const { filename, data } of ruleFiles) {
    const result = RuleSchema.safeParse(data);
    if (!result.success) {
      ruleStats.errors += 1;
      hasErrors = true;
      // eslint-disable-next-line no-console
      console.error(`  ERR ${filename}: ${result.error.message}`);
      continue;
    }

    const familyExists = validFamilies.includes(result.data.family_id);
    if (!familyExists) {
      ruleStats.errors += 1;
      hasErrors = true;
      // eslint-disable-next-line no-console
      console.error(
        `  ERR ${filename}: family_id '${result.data.family_id}' not found in families/`
      );
    } else {
      ruleStats.valid += 1;
      validRuleData.push({
        id: result.data.id,
        family_id: result.data.family_id,
        family_version: result.data.family_version,
        priority: result.data.priority,
        // rule_json — весь объект правила целиком (так buildFromRules
        // работает с одним полем, не склеивая колонки и JSON).
        // Подробности — комментарий в rule-engine-migration.sql §rules.
        rule_json: result.data,
        tenant_id: null, // все правила в репо — глобальные
        enabled: result.data.enabled ?? true,
      });
      // eslint-disable-next-line no-console
      console.log(
        `  OK  ${filename} -> ${result.data.id} (family=${result.data.family_id})`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Пресеты
  // ---------------------------------------------------------------------------
  const presetFiles = loadJsonDir('presets');
  const presetStats: ValidationStats = {
    total: presetFiles.length,
    valid: 0,
    errors: 0,
  };
  const validPresetData: Array<{
    id: string;
    display_name: string;
    sections: unknown;
    print_type: string;
    pages_per_spread: number;
    tenant_id: string | null;
    version: string;
    parent_preset_id: string | null;
    enabled: boolean;
  }> = [];

  // eslint-disable-next-line no-console
  console.log(`\nPresets: ${presetFiles.length} files`);

  for (const { filename, data } of presetFiles) {
    const result = PresetSchema.safeParse(data);
    if (!result.success) {
      presetStats.errors += 1;
      hasErrors = true;
      // eslint-disable-next-line no-console
      console.error(`  ERR ${filename}: ${result.error.message}`);
      continue;
    }

    let presetHasIssues = false;

    // 3a. Ссылки на семейства
    for (const section of result.data.sections) {
      if (!validFamilies.includes(section.family_id)) {
        // eslint-disable-next-line no-console
        console.error(
          `     ! family_id '${section.family_id}' not found in families/`
        );
        presetHasIssues = true;
        hasErrors = true;
      }

      // 3b. Валидация параметров секции по матрице §4.4
      const sectionErrors = validateSectionParams(section);
      for (const err of sectionErrors) {
        // eslint-disable-next-line no-console
        console.error(`     ! ${err}`);
        presetHasIssues = true;
        hasErrors = true;
      }
    }

    if (presetHasIssues) {
      presetStats.errors += 1;
    } else {
      presetStats.valid += 1;
      validPresetData.push({
        id: result.data.id,
        display_name: result.data.display_name,
        sections: result.data.sections,
        print_type: result.data.print_type,
        pages_per_spread: result.data.pages_per_spread,
        tenant_id: result.data.tenant_id,
        version: result.data.version,
        parent_preset_id: result.data.parent_preset_id ?? null,
        enabled: result.data.enabled ?? true,
      });
      // eslint-disable-next-line no-console
      console.log(
        `  OK  ${filename} -> ${result.data.id} (${result.data.sections.length} sections, print=${result.data.print_type})`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Итог валидации
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log('\nValidation summary:');
  // eslint-disable-next-line no-console
  console.log(
    `  families: ${familyStats.valid}/${familyStats.total} valid (${familyStats.errors} errors)`
  );
  // eslint-disable-next-line no-console
  console.log(
    `  rules:    ${ruleStats.valid}/${ruleStats.total} valid (${ruleStats.errors} errors)`
  );
  // eslint-disable-next-line no-console
  console.log(
    `  presets:  ${presetStats.valid}/${presetStats.total} valid (${presetStats.errors} errors)`
  );

  if (hasErrors) {
    // eslint-disable-next-line no-console
    console.error('\nFAILED: validation errors found, aborting (no DB writes).');
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 4. WRITE-режим: UPSERT семейств → правил → пресетов в Supabase
  // ---------------------------------------------------------------------------
  if (!writeMode) {
    // eslint-disable-next-line no-console
    console.log('\nOK: all data valid (read-only mode, no DB writes).');
    // eslint-disable-next-line no-console
    console.log('   Run with --write to UPSERT families + rules + presets into Supabase.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('\nWriting to Supabase…');
  // Динамический import — supabase.ts кидает Error при отсутствии env,
  // в read-only режиме нам это не нужно.
  const { supabaseAdmin } = await import('../lib/supabase');

  // 4a. UPSERT семейств (rules.family_id ссылается через FK — пишем первыми).
  // UPSERT по PRIMARY KEY id (TEXT). Если строки нет — вставит, если есть — обновит.
  const { error: familiesError, count: familiesCount } = await supabaseAdmin
    .from('template_families')
    .upsert(validFamilyData, { onConflict: 'id', count: 'exact' });

  if (familiesError) {
    // eslint-disable-next-line no-console
    console.error(`Failed to UPSERT template_families: ${familiesError.message}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`  UPSERTed ${familiesCount ?? validFamilyData.length} rows to template_families`);

  // 4b. UPSERT правил (зависят от семейств, поэтому после них).
  const { error: rulesError, count: rulesCount } = await supabaseAdmin
    .from('rules')
    .upsert(validRuleData, { onConflict: 'id', count: 'exact' });

  if (rulesError) {
    // eslint-disable-next-line no-console
    console.error(`Failed to UPSERT rules: ${rulesError.message}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`  UPSERTed ${rulesCount ?? validRuleData.length} rows to rules`);

  // 4c. UPSERT пресетов (FK parent_preset_id ссылается на сами presets,
  // в текущих данных таких ссылок нет — порядок внутри upsert неважен).
  const { error: presetsError, count: presetsCount } = await supabaseAdmin
    .from('presets')
    .upsert(validPresetData, { onConflict: 'id', count: 'exact' });

  if (presetsError) {
    // eslint-disable-next-line no-console
    console.error(`Failed to UPSERT presets: ${presetsError.message}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`  UPSERTed ${presetsCount ?? validPresetData.length} rows to presets`);

  // eslint-disable-next-line no-console
  console.log('\nDone.');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
