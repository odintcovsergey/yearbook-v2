/**
 * Адаптер legacy AlbumInput → RulesAlbumInput (РЭ.14.1).
 *
 * Структуры близкие, но различия:
 *   - legacy.head_teacher может быть null → rules заполняем пустыми
 *     строками + photo:null (правила head-teacher не сматчат и секция
 *     корректно пропустится через section_complete=true)
 *   - legacy.common_photos.half → rules.common_photos.half_class
 *     (исторически legacy использовал короткое 'half', spec rule engine
 *     стандартизировал 'half_class')
 *   - legacy.common_photos.collage → rules.common_photos.collage
 *     (04.06.2026: collage разведён с sixth, см. tz-sixth-collage-split.md).
 *   - legacy students имеют больше полей (template_set_id зависимый
 *     student.text, secondary_portraits), но rules.RulesStudentInput
 *     совместима по подмножеству (full_name, portrait, quote, friend_photos).
 *
 * Поле template_set_id из legacy AlbumInput выбрасывается — rule engine
 * получает template_set через RuleEngineBundle отдельно.
 *
 * РЭ.18: common_section_max_spreads ИЗ legacy переносится в rules
 * (до РЭ.18 выбрасывалось как legacy-only). Используется правилами
 * common-section-*-pair для ограничения количества разворотов раздела.
 * Поле albums.common_section_max_spreads читается smart-fill'ом и попадает
 * в AlbumInput. null/undefined = без лимита, 0 = раздел отключён,
 * >0 = жёсткий лимит. Соответствует legacy поведению buildCommonSection.
 */

import type {
  RulesAlbumInput,
  RulesStudentInput,
  RulesSubjectInput,
  RulesHeadTeacherInput,
  RulesCommonPhotosInput,
} from './types';
import type { AlbumInput } from '@/lib/album-builder/types';

export function adaptLegacyAlbumInput(legacy: AlbumInput): RulesAlbumInput {
  // ТЗ 17.06.2026: до двух равных главных. Источник — legacy.head_teachers
  // (массив 0..2); если его нет (старые вызовы) — деривируем из одиночного
  // legacy.head_teacher.
  const head_teachers: RulesHeadTeacherInput[] = (
    legacy.head_teachers && legacy.head_teachers.length > 0
      ? legacy.head_teachers
      : legacy.head_teacher
        ? [legacy.head_teacher]
        : []
  ).map((h) => ({ name: h.name, role: h.role, text: h.text, photo: h.photo }));

  // head_teacher (одиночный) сохранён для обратной совместимости = первый,
  // либо пустой stub (правила head-teacher тогда не сматчат и секция
  // корректно пропустится).
  const head_teacher: RulesHeadTeacherInput =
    head_teachers[0] ?? { name: '', role: '', text: '', photo: null };

  const subjects: RulesSubjectInput[] = legacy.subjects.map((s) => ({
    name: s.name,
    role: s.role,
    photo: s.photo,
  }));

  const students: RulesStudentInput[] = legacy.students.map((st) => ({
    full_name: st.full_name,
    portrait: st.portrait,
    quote: st.quote,
    friend_photos: st.friend_photos,
  }));

  const common_photos: RulesCommonPhotosInput = {
    full_class: legacy.common_photos.full_class,
    half_class: legacy.common_photos.half, // ← переименование
    spread: legacy.common_photos.spread,
    quarter: legacy.common_photos.quarter,
    sixth: legacy.common_photos.sixth,
    collage: legacy.common_photos.collage,
  };

  return {
    students,
    subjects,
    head_teacher,
    head_teachers,
    common_photos,
    common_section_max_spreads: legacy.common_section_max_spreads,
    student_distribution: legacy.student_distribution,
  };
}
