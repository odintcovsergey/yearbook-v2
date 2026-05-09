/**
 * Публичный API album-builder.
 *
 * Финальная версия после 0.5.3.4: единственный builder работает с Preset,
 * scenarios.ts удалён, типы scenarios исключены из публичного API.
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
