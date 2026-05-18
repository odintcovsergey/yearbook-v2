/**
 * Точка входа для функций-секций. Каждый файл реализует одну секцию
 * из `preset.section_structure` (по типу section.type).
 *
 * Все функции мутируют SectionFillContext (см. shared.ts) — стандартный
 * builder-паттерн.
 *
 * Текущее покрытие (РЭ.21.8.4b):
 *  - common   — fillCommonSection
 *  - teachers — fillTeachersSection
 *  - students — fillStudentsSection (только Standard + Universal;
 *               Medium/Light/Mini → 21.8.4c)
 *
 * Заглушки до соответствующих коммитов:
 *  - soft_intro — РЭ.21.8.5 (S-Intro для sheet_type='soft')
 *  - soft_final — РЭ.21.8.5
 *  - vignette   — отложено
 */

export { fillCommonSection } from './common';
export { fillTeachersSection } from './teachers';
export { fillStudentsSection } from './students';
export type { SectionFillContext } from './shared';
