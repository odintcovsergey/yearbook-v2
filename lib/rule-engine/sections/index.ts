/**
 * Точка входа для функций-секций. Каждый файл реализует одну секцию
 * из `preset.section_structure` (по типу section.type).
 *
 * Все функции мутируют SectionFillContext (см. shared.ts) — стандартный
 * builder-паттерн.
 *
 * Текущее покрытие (РЭ.21.8.5):
 *  - common     — fillCommonSection
 *  - teachers   — fillTeachersSection
 *  - students   — fillStudentsSection (все 5 density: standard/universal/medium/light/mini)
 *  - soft_intro — fillSoftIntroSection (только для sheet_type='soft')
 *  - soft_final — fillSoftFinalSection (только для sheet_type='soft')
 *
 * Заглушки:
 *  - vignette   — отложено (отдельная подсистема, виньетки из детских фото)
 */

export { fillCommonSection, fillCommonAutoSection } from './common';
export { fillCommonRequiredSection } from './common-required';
export { fillTeachersSection } from './teachers';
export { fillStudentsSection } from './students';
export { fillSoftIntroSection } from './soft-intro';
export { fillSoftFinalSection } from './soft-final';
export type { SectionFillContext } from './shared';
