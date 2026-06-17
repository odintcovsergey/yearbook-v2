/**
 * Человекочитаемая подпись мастера общего раздела для пикеров (ФИКС 2 ТЗ
 * «привязка портрета/имени + человекочитаемые имена мастеров»).
 *
 * Зачем:
 * Партнёр не должен видеть техимя `J-Collage-4` / `J-Sixth-6` — оно ничего
 * ему не говорит. Подпись карточки строим по смыслу (по слотам мастера),
 * а техимя оставляем мелким серым подзаголовком для своих/отладки.
 *
 * Чистая функция (по placeholders), тестируется без Supabase.
 *
 * NB: техимя в БД/IDML НЕ меняем — это системное имя. Меняем только
 * отображаемую подпись в UI.
 */

/** Минимальный интерфейс мастера для построения подписи. */
export type MasterLabelCandidate = {
  name: string;
  placeholders?: { label: string }[] | null;
};

/**
 * Возвращает человекочитаемую подпись мастера по составу его слотов.
 *
 * Маппинг (общий раздел):
 *   classphotoframe (full) → «Общее фото класса (1 фото на страницу)»
 *   halfphoto × N          → «Половина класса (N фото на страницу)»
 *   quarterphoto × N       → «Четверть класса (N фото на страницу)»
 *   sixthphoto × N         → «1/6 класса (N фото на страницу)»
 *   collagephoto × N       → «Коллаж — N фото на страницу»
 *   spreadphoto            → «Фото на весь разворот»
 *
 * Для мастеров других разделов (личный/учительский) и нераспознанных —
 * fallback на техимя мастера.
 */
export function humanMasterLabel(master: MasterLabelCandidate): string {
  let hasFull = false;
  let halfCount = 0;
  let quarterCount = 0;
  let sixthCount = 0;
  let collageCount = 0;
  let hasSpread = false;

  for (const ph of master.placeholders ?? []) {
    const l = ph.label.toLowerCase();
    if (l === 'classphotoframe') hasFull = true;
    else if (/^halfphoto_\d+$/.test(l)) halfCount++;
    else if (/^quarterphoto_\d+$/.test(l)) quarterCount++;
    else if (/^sixthphoto_\d+$/.test(l)) sixthCount++;
    else if (/^collagephoto_\d+$/.test(l)) collageCount++;
    else if (l === 'spreadphoto') hasSpread = true;
  }

  // Приоритет совпадает с classifyMaster в JMasterPicker.
  if (hasSpread) return 'Фото на весь разворот';
  if (sixthCount > 0) return `1/6 класса (${sixthCount} фото на страницу)`;
  if (collageCount > 0) return `Коллаж — ${collageCount} фото на страницу`;
  if (quarterCount >= 2) return `Четверть класса (${quarterCount} фото на страницу)`;
  if (halfCount >= 2) return `Половина класса (${halfCount} фото на страницу)`;
  if (hasFull) return 'Общее фото класса (1 фото на страницу)';

  // Личный раздел: портрет / имя / цитата / фото с друзьями.
  let hasPortrait = false;
  let hasName = false;
  let hasQuote = false;
  let studentPhotoCount = 0;
  for (const ph of master.placeholders ?? []) {
    const l = ph.label.toLowerCase();
    if (/^studentportrait(_\d+)?$/.test(l)) hasPortrait = true;
    else if (/^studentname(_\d+)?$/.test(l)) hasName = true;
    else if (/^studentquote(_\d+)?$/.test(l)) hasQuote = true;
    else if (/^(?:studentphoto|friendphoto)_?\d+$/.test(l)) studentPhotoCount++;
  }
  if (hasPortrait) {
    // Парадная страница ученика.
    const parts = ['портрет'];
    if (hasName) parts.push('ФИО');
    if (hasQuote) parts.push('цитата');
    if (studentPhotoCount > 0) parts.push(`${studentPhotoCount} фото`);
    return `Личная: ${parts.join(' + ')}`;
  }
  if (studentPhotoCount > 0) {
    // Коллажная страница ученика (без портрета).
    return `Коллаж ученика — ${studentPhotoCount} фото`;
  }

  // Нераспознанный / мастер другого раздела — техимя как fallback.
  return master.name;
}
