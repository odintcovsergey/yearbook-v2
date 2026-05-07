/**
 * Публичный API album-builder.
 *
 * В подэтапе 0.9 экспортируются только декларации (типы + helpers + SCENARIOS).
 * Алгоритм buildAlbum появится в 0.10.
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
  Config,
  SpreadInstance,
  BuildWarningCode,
  BuildWarning,
  BuildResult,
  BuildContext,
} from './types';

export { chunk, assertExhaustive, pushWarning } from './utils';

export { SCENARIOS_LAYFLAT } from './scenarios';
export type { MasterFilter, StudentSection, ScenarioDef } from './scenarios';
