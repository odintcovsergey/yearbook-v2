/**
 * Точка входа для функций-секций. Каждый файл реализует одну секцию
 * из `preset.section_structure` (по типу section.type).
 *
 * Все функции мутируют SectionFillContext (см. shared.ts) — стандартный
 * builder-паттерн.
 *
 * Текущее покрытие (РЭ.21.8.4a):
 *  - common   — fillCommonSection
 *  - teachers — fillTeachersSection
 *
 * Заглушки до соответствующих коммитов:
 *  - students   — РЭ.21.8.4b
 *  - soft_intro — РЭ.21.8.5
 *  - soft_final — РЭ.21.8.5
 *  - vignette   — отложено
 */

export { fillCommonSection } from './common';
export { fillTeachersSection } from './teachers';
export type { SectionFillContext } from './shared';
