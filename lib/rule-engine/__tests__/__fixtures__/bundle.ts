/**
 * Фикстуры RuleEngineBundle для build.test.ts (РЭ.10.4 / РЭ.10.5).
 *
 * Загружает реальные данные:
 *   - 7 семейств из docs/rule-engine-data/families/
 *   - 36 правил из docs/rule-engine-data/rules/**\/
 *   - 7 пресетов из docs/rule-engine-data/presets/
 *   - 25 тестовых мастеров из ./masters.ts
 *
 * Это позволяет тестировать buildFromRules на той же конфигурации
 * которую seed-rule-engine.ts заливает в боевой Supabase. Если в
 * репо добавится новое правило/пресет — тесты подхватят автоматически.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Preset, Rule, TemplateFamily } from '../../types';
import type { RuleEngineBundle } from '../../loaders';
import type { TemplateSet } from '@/lib/album-builder/types';
import { TEST_MASTERS, makeMastersByName } from './masters';

const DATA_ROOT = join(process.cwd(), 'docs', 'rule-engine-data');

function loadJsonRecursive(subdir: string): unknown[] {
  const root = join(DATA_ROOT, subdir);
  const out: unknown[] = [];
  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.json')) {
        out.push(JSON.parse(readFileSync(full, 'utf-8')));
      }
    }
  }
  walk(root);
  return out;
}

let cachedFamilies: TemplateFamily[] | null = null;
let cachedRules: Rule[] | null = null;
let cachedPresets: Map<string, Preset> | null = null;

export function loadTestFamilies(): TemplateFamily[] {
  if (cachedFamilies) return cachedFamilies;
  cachedFamilies = loadJsonRecursive('families') as TemplateFamily[];
  return cachedFamilies;
}

export function loadTestRules(): Rule[] {
  if (cachedRules) return cachedRules;
  const raw = loadJsonRecursive('rules') as Rule[];
  // Сортируем по priority desc как и в БД через ORDER BY (loaders.ts)
  cachedRules = raw.slice().sort((a, b) => b.priority - a.priority);
  return cachedRules;
}

export function loadTestPresets(): Map<string, Preset> {
  if (cachedPresets) return cachedPresets;
  const raw = loadJsonRecursive('presets') as Preset[];
  cachedPresets = new Map();
  for (const p of raw) cachedPresets.set(p.id, p);
  return cachedPresets;
}

/** Мини-TemplateSet с тестовыми мастерами (для bundle.templateSet). */
function makeTestTemplateSet(): TemplateSet {
  return {
    id: 'test-template-set',
    tenant_id: null,
    name: 'Test',
    slug: 'okeybook-default',
    print_type: 'layflat',
    page_width_mm: 200,
    page_height_mm: 280,
    spread_width_mm: 400,
    spread_height_mm: 280,
    bleed_mm: 3,
    facing_pages: true,
    page_binding: 'LeftToRight',
    spreads: TEST_MASTERS,
  };
}

/**
 * Главный helper — создаёт RuleEngineBundle для теста buildFromRules.
 *
 * @param presetId — id из docs/rule-engine-data/presets/*.json
 *                   (например 'standard', 'maximum', 'mini-soft', 'individual')
 */
export function makeBundle(presetId: string): RuleEngineBundle {
  const presets = loadTestPresets();
  const preset = presets.get(presetId);
  if (!preset) {
    throw new Error(`test preset '${presetId}' not found in docs/rule-engine-data/presets/`);
  }
  return {
    preset,
    rules: loadTestRules(),
    families: loadTestFamilies(),
    templateSet: makeTestTemplateSet(),
    mastersByName: makeMastersByName(),
  };
}
