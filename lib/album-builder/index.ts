/**
 * Публичный API album-builder.
 *
 * Финальная версия после 0.5.3.4: единственный builder работает с Preset,
 * scenarios.ts удалён, типы scenarios исключены из публичного API.
 *
 * После РЭ.9.5: добавлены реэкспорты rule engine (lib/rule-engine/) и
 * обёртка buildAlbumOrFallback с автоматическим фолбэком на legacy
 * buildAlbum при сбое rule engine.
 */

export type {
  Photo,
  Student,
  HeadTeacher,
  Subject,
  CommonPhotos,
  AlbumInput,
  ConfigType,
  PrintType,
  MasterType,
  PageRole,
  SlotCapacity,
  PlaceholderCommon,
  PhotoPlaceholder,
  TextPlaceholder,
  OvalPlaceholder,
  Placeholder,
  SpreadTemplate,
  TemplateSet,
  SpreadInstance,
  BuildWarningCode,
  BuildWarning,
  BuildResult,
  MasterFilter,
  Preset,
  PresetConfig,
  StudentSectionConfig,
  TeacherSectionConfig,
  IntroSectionConfig,
  CoverSectionConfig,
  BaseLayoutMode,
  FirstSpreadContent,
  FriendPhotosContent,
  ThumbnailsSectionConfig,
} from './types';

export { chunk, assertExhaustive, pushWarning } from './utils';

export { findMaster } from './find-master';
export type { FindMasterResult } from './find-master';

export { buildAlbum } from './build-from-preset';

export { loadTemplateSet, loadPresetBySlug, loadPresetById } from './load-template-set';

// ─── Rule engine реэкспорты (РЭ.9.5) ──────────────────────────────────────

export { buildFromRules } from '../rule-engine/build';
export { loadBundle } from '../rule-engine/loaders';
export type {
  AlbumLayout,
  DecisionTraceEntry,
  PageInstance,
  SpreadInstance as RulesSpreadInstance,
  RulesAlbumInput,
  RulesStudentInput,
  RulesSubjectInput,
  RulesHeadTeacherInput,
  RulesCommonPhotosInput,
  Preset as RulesPreset,
  Rule,
  TemplateFamily,
  RuleContext,
  Density,
  LayoutStatus,
} from '../rule-engine/types';
export type { RuleEngineBundle } from '../rule-engine/loaders';

// ─── Обёртка с фолбэком (РЭ.9.5) ──────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAlbum as legacyBuildAlbum } from './build-from-preset';
import { loadBundle as ruleLoadBundle } from '../rule-engine/loaders';
import { buildFromRules as ruleBuildFromRules } from '../rule-engine/build';
import type {
  AlbumInput as LegacyAlbumInput,
  BuildResult as LegacyBuildResult,
  Preset as LegacyPreset,
  TemplateSet as LegacyTemplateSet,
} from './types';
import type {
  AlbumLayout as RulesAlbumLayout,
  RulesAlbumInput as RulesEngineInput,
} from '../rule-engine/types';

/**
 * Дискриминированный результат сборки: либо новый rule engine layout,
 * либо legacy BuildResult. Caller проверяет engine и забирает свою ветку.
 */
export type EngineBuildResult =
  | {
      engine: 'rules';
      layout: RulesAlbumLayout;
      /** Какие предупреждения сгенерировал rule engine (не фолбэк). */
      rules_warnings: string[];
    }
  | {
      engine: 'legacy';
      result: LegacyBuildResult;
      /** Если фолбэк случился из-за rule engine ошибки — её текст. */
      fallback_reason?: string;
    };

export interface BuildAlbumOrFallbackOptions {
  supabase: SupabaseClient;
  /**
   * Если задан — пытаемся через rule engine. Если null или undefined →
   * сразу legacy buildAlbum.
   */
  rulesPresetId: string | null;
  /** Input для rule engine (структура отличается от legacy). */
  rulesInput?: RulesEngineInput;
  /** tenant_id для tenant-aware правил/пресетов (null = только глобальные). */
  tenantId: string | null;
  // РЭ.21.6.2: templateSetSlug удалён — slug теперь хранится в preset.template_set_id
  // и резолвится внутри loadBundle (с фолбэком на 'okeybook-default').

  /** Legacy ветка: всегда нужна как фолбэк. */
  legacyInput: LegacyAlbumInput;
  legacyPreset: LegacyPreset;
  legacyTemplateSet: LegacyTemplateSet;
}

/**
 * Обёртка для caller'а (API endpoint POST /api/layout?action=build_album).
 *
 * Логика:
 *   1. Если rulesPresetId задан И rulesInput задан → пытаемся через rule engine.
 *   2. При исключении ИЛИ status='failed' → фолбэк на legacy buildAlbum.
 *   3. Status='partial' НЕ триггерит фолбэк (это нормально — есть warnings,
 *      но layout валидный). Caller сам решает что с этим делать.
 *
 * Этот wrapper НЕ заменяет существующие места вызова buildAlbum в коде —
 * это новая точка входа для постепенной миграции с config_presets на
 * rule engine. POST /api/layout будет использовать её в РЭ.13.
 */
export async function buildAlbumOrFallback(
  opts: BuildAlbumOrFallbackOptions,
): Promise<EngineBuildResult> {
  // Если rule engine не запрошен → сразу legacy
  if (!opts.rulesPresetId || !opts.rulesInput) {
    const result = legacyBuildAlbum(
      opts.legacyInput,
      opts.legacyPreset,
      opts.legacyTemplateSet,
    );
    return { engine: 'legacy', result };
  }

  // Пытаемся через rule engine
  try {
    const bundle = await ruleLoadBundle(
      opts.supabase,
      opts.rulesPresetId,
      opts.tenantId,
    );
    const layout = ruleBuildFromRules(opts.rulesInput, bundle);

    if (layout.status === 'failed') {
      // Критическая ошибка — фолбэк
      const result = legacyBuildAlbum(
        opts.legacyInput,
        opts.legacyPreset,
        opts.legacyTemplateSet,
      );
      return {
        engine: 'legacy',
        result,
        fallback_reason: `rule engine status=failed: ${layout.warnings.join('; ')}`,
      };
    }

    return {
      engine: 'rules',
      layout,
      rules_warnings: layout.warnings,
    };
  } catch (e) {
    // Любое исключение (load failure, etc) → фолбэк
    const result = legacyBuildAlbum(
      opts.legacyInput,
      opts.legacyPreset,
      opts.legacyTemplateSet,
    );
    return {
      engine: 'legacy',
      result,
      fallback_reason: `rule engine threw: ${(e as Error).message}`,
    };
  }
}
