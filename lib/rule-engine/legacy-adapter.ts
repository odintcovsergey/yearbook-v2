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
 *   - legacy имеет CommonPhotos.collage (DEPRECATED), у rules его нет.
 *     Не маппим (если есть данные — уже мигрированы в sixth до smart-fill).
 *   - legacy students имеют больше полей (template_set_id зависимый
 *     student.text, secondary_portraits), но rules.RulesStudentInput
 *     совместима по подмножеству (full_name, portrait, quote, friend_photos).
 *
 * Поле template_set_id из legacy AlbumInput выбрасывается — rule engine
 * получает template_set через RuleEngineBundle отдельно.
 *
 * common_section_max_spreads из legacy НЕ переносится — это legacy-only
 * концепция. В rule engine лимит общего раздела управляется через
 * правила common-section (priorities).
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
  const head_teacher: RulesHeadTeacherInput = legacy.head_teacher
    ? {
        name: legacy.head_teacher.name,
        role: legacy.head_teacher.role,
        text: legacy.head_teacher.text,
        photo: legacy.head_teacher.photo,
      }
    : { name: '', role: '', text: '', photo: null };

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
  };

  return { students, subjects, head_teacher, common_photos };
}
