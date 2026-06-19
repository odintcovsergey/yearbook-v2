// Человекочитаемые названия элементов обложки для панели «Видимость».
// Ключи — канонические метки плейсхолдеров (lib/cover/types.ts).

const NAMES: Record<string, string> = {
  cover_portrait: 'Портрет',
  cover_common_photo: 'Общее фото',
  cover_student_name: 'Имя выпускника',
  cover_school_name: 'Школа',
  cover_city: 'Город',
  cover_year: 'Год',
  cover_class: 'Класс',
  cover_title: 'Заголовок',
  cover_subtitle: 'Подзаголовок',
  spine_text: 'Текст на корешке',
  back_logo: 'Логотип',
  back_contacts: 'Контакты',
  back_common_photo: 'Фото на задней',
  back_qr: 'QR-код',
}

/** Человекочитаемое имя элемента обложки по его метке (с разумным фолбэком). */
export function elementLabelName(label: string): string {
  if (NAMES[label]) return NAMES[label]
  // Декор: `<base>__under` / `__over` / `__fg` / `__fg_n`.
  if (/__under$/.test(label)) return 'Декор (фон)'
  if (/__over$/.test(label)) return 'Декор'
  if (/^__fg(_\d+)?$/.test(label)) return 'Декор (передний план)'
  // Произвольная декоративная подпись из IDML.
  return label.replace(/_/g, ' ')
}
