/**
 * РЭ.28: публичный API модуля template-set-clone.
 *
 * Чистые функции для resize'а partner-клонов template_set'ов.
 * Без зависимостей от Supabase — тестируются в vitest без env.
 *
 * Паттерн как lib/album-builder/print-type-resolver.ts (РЭ.27.3)
 * и lib/smart-fill/filter-by-purchase.ts (РЭ.25.3).
 */

export { PRINT_DPI, MM_STEP } from './constants';

export { roundMmToPx, mmToPx } from './round-to-pixels';

export {
  checkAspectCompatibility,
} from './aspect-compatibility';
export type {
  AspectCompatibilityLevel,
  AspectCompatibilityResult,
} from './aspect-compatibility';

export { resizePlaceholder } from './resize-placeholder';

export { prepareTemplateSetClone } from './prepare-clone';
export type {
  SourceTemplateSet,
  SourceMaster,
  CloneRequest,
  ClonedTemplateSetRecord,
  ClonedMasterRecord,
  ClonePlan,
} from './prepare-clone';
