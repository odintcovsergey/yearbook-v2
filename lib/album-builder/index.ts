/**
 * Публичный API album-builder.
 *
 * Финальная версия после 0.5.3.4: единственный builder работает с Preset,
 * scenarios.ts удалён, типы scenarios исключены из публичного API.
 *
 * Реэкспорты rule engine (lib/rule-engine/) для loadBundle и типов
 * RulesAlbumInput используются buildFromSectionStructure (движок 3).
 *
 * История:
 *   - РЭ.9.5: добавлен реэкспорт buildFromRules + обёртка buildAlbumOrFallback
 *   - РЭ.21.8.чистка-1 (20.05.2026): удалён buildFromRules (движок 2) и
 *     обёртка buildAlbumOrFallback. Остался только legacy buildAlbum и
 *     инфраструктура для движка 3 (loadBundle, RulesAlbumInput, и т.д.).
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

// ─── Rule engine реэкспорты (для движка 3 — buildFromSectionStructure) ─────

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
