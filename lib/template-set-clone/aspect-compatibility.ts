/**
 * РЭ.28: проверка совместимости пропорций при partner-клонировании.
 *
 * Если партнёр меняет размер страницы непропорционально (соотношение
 * сторон сильно отличается от исходного), мастера и placeholder'ы
 * исказятся при resize'е:
 *   - круги (учительские аватарки) превратятся в овалы
 *   - фиксированные отступы поедут
 *   - тонкие рамки могут сместиться
 *
 * Три уровня (см. РЭ.28-spec §3.3, развилка B):
 *   < 5%  → 'ok'      — тихо клонируем, разница незаметна
 *   5-10% → 'warning' — даём клонировать, партнёр видит предупреждение
 *   > 10% → 'blocked' — не даём клонировать, обязательно искажения
 *
 * Чистая функция, без зависимостей от Supabase.
 */

export type AspectCompatibilityLevel = 'ok' | 'warning' | 'blocked';

export type AspectCompatibilityResult = {
  level: AspectCompatibilityLevel;
  /** Разница пропорций в процентах. 5.2 значит «новый аспект отличается на 5.2%». */
  aspect_diff_percent: number;
  /** Текст для UI (русский). */
  message: string;
};

/**
 * Граница где warning превращается в blocked (в процентах).
 */
const WARNING_THRESHOLD = 5;
const BLOCKED_THRESHOLD = 10;

/**
 * Оценивает насколько целевые размеры совместимы с исходными по
 * соотношению сторон.
 *
 * Метрика: max(a/b, b/a) - 1, где a и b — два аспекта (target и origin).
 * Симметрична: разница(A→B) === разница(B→A). Не зависит от того
 * какой из аспектов больше.
 *
 * Возвращает уровень + процент + сообщение для UI. Сам выбор «можно
 * клонировать или нет» делает caller (API в РЭ.28.3) на основе level.
 */
export function checkAspectCompatibility(
  originalWidthMm: number,
  originalHeightMm: number,
  targetWidthMm: number,
  targetHeightMm: number,
): AspectCompatibilityResult {
  if (
    originalHeightMm <= 0 ||
    targetHeightMm <= 0 ||
    originalWidthMm <= 0 ||
    targetWidthMm <= 0
  ) {
    return {
      level: 'blocked',
      aspect_diff_percent: 100,
      message: 'Размеры должны быть положительными числами',
    };
  }

  const originalAspect = originalWidthMm / originalHeightMm;
  const targetAspect = targetWidthMm / targetHeightMm;

  // Симметричная метрика: больший/меньший - 1.
  const ratio = Math.max(originalAspect, targetAspect) /
                Math.min(originalAspect, targetAspect);
  const diffPercent = (ratio - 1) * 100;
  const diffPercentRounded = Math.round(diffPercent * 10) / 10;

  if (diffPercent < WARNING_THRESHOLD) {
    return {
      level: 'ok',
      aspect_diff_percent: diffPercentRounded,
      message:
        diffPercentRounded === 0
          ? 'Пропорции совпадают с исходным дизайном — resize пройдёт точно'
          : `Пропорции близки к исходному дизайну (разница ${diffPercentRounded}%). Resize пройдёт корректно.`,
    };
  }

  if (diffPercent < BLOCKED_THRESHOLD) {
    return {
      level: 'warning',
      aspect_diff_percent: diffPercentRounded,
      message:
        `Соотношение сторон отличается от исходного на ${diffPercentRounded}%. ` +
        'Мастера будут немного деформированы (круги станут овалами, ' +
        'отступы изменятся). Рекомендуем выбрать дизайн ближе по ' +
        'пропорциям, но клонировать можно.',
    };
  }

  return {
    level: 'blocked',
    aspect_diff_percent: diffPercentRounded,
    message:
      `Соотношение сторон отличается от исходного на ${diffPercentRounded}% ` +
      `(больше ${BLOCKED_THRESHOLD}%). Мастера будут серьёзно искажены — ` +
      'выберите дизайн с подходящими пропорциями или загрузите свой ' +
      'через техподдержку (сценарий B).',
  };
}
