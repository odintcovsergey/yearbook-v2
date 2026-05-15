/**
 * Сидер для rule engine — читает JSON из docs/rule-engine-data/,
 * валидирует Zod-схемами, проверяет ссылочную целостность.
 *
 * В РЭ.3 (этот коммит): только read-only валидация.
 * UPSERT в Supabase будет добавлен в РЭ.8 когда наберётся
 * критическая масса правил.
 *
 * Запуск: npx tsx scripts/seed-rule-engine.ts
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

function loadJsonDir(subdir: string): LoadedFile[] {
  const dirPath = join(DATA_ROOT, subdir);
  if (!existsSync(dirPath)) return [];

  const files = readdirSync(dirPath).filter((f) => f.endsWith('.json'));
  return files.map((filename) => {
    const content = readFileSync(join(dirPath, filename), 'utf-8');
    return { filename, data: JSON.parse(content) };
  });
}

interface ValidationStats {
  total: number;
  valid: number;
  errors: number;
}

function main(): void {
  // eslint-disable-next-line no-console
  console.log('Reading rule engine data from:', DATA_ROOT);

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

  // eslint-disable-next-line no-console
  console.log(`\nFamilies: ${familyFiles.length} files`);

  for (const { filename, data } of familyFiles) {
    const result = TemplateFamilySchema.safeParse(data);
    if (result.success) {
      validFamilies.push(result.data.id);
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
      // eslint-disable-next-line no-console
      console.log(
        `  OK  ${filename} -> ${result.data.id} (${result.data.sections.length} sections, print=${result.data.print_type})`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Итог
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log('\nSummary:');
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
    console.error('\nFAILED: validation errors found.');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('\nOK: all data valid (read-only mode, no DB writes yet).');
}

main();
