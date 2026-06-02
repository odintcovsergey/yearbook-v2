/**
 * Геометрия полотна обложки под РЕАЛЬНЫЙ корешок — Этап 5
 * (ТЗ docs/tz-cover-design.md).
 *
 * Дизайнер рисует обложку с НОМИНАЛЬНЫМ корешком (заглушкой). Реальная ширина
 * корешка зависит от толщины альбома (computeAlbumSpineWidthMm, Этап 3). Эта
 * функция «раздвигает» полотно под реальный корешок:
 *   - задняя зона (back)  — на месте;
 *   - корешок (spine)     — растёт симметрично, контент держим по центру;
 *   - передняя зона (front) — сдвигается вправо на разницу (real − nominal).
 *
 * Чистая функция, без БД/DOM — используется и превью (SVG/канвас), и PDF.
 */

/** Зона полотна обложки. */
export type CoverZoneName = 'back' | 'spine' | 'front';

export type CoverLayoutInput = {
  /** Ширина задней зоны (мм). */
  backWidthMm: number;
  /** Ширина передней зоны (мм). */
  frontWidthMm: number;
  /** Высота полотна (мм). */
  heightMm: number;
  /** Номинальная ширина корешка из макета (как нарисовал дизайнер). */
  nominalSpineWidthMm: number;
  /** Реальная ширина корешка (из числа листов + пресета печати). */
  realSpineWidthMm: number;
};

export type CoverLayoutResult<T> = {
  /** Полная ширина полотна под реальный корешок (мм). */
  width_mm: number;
  height_mm: number;
  /** Левая граница корешка (= ширина задней зоны), мм. */
  spine_left_mm: number;
  /** Правая граница корешка, мм. */
  spine_right_mm: number;
  /** Плейсхолдеры с пересчитанными x_mm под реальный корешок. */
  placeholders: T[];
};

/**
 * Пересчитывает позиции плейсхолдеров под реальную ширину корешка.
 *
 * Плейсхолдеры должны нести `zone` (проставляется парсером, Этап 2). Без зоны
 * (на всякий случай) — трактуются как задняя зона (не сдвигаются).
 */
export function layoutCover<T extends { x_mm: number; zone?: CoverZoneName }>(
  input: CoverLayoutInput,
  placeholders: T[],
): CoverLayoutResult<T> {
  const { backWidthMm, frontWidthMm, heightMm, nominalSpineWidthMm, realSpineWidthMm } = input;
  const delta = realSpineWidthMm - nominalSpineWidthMm;

  const adjusted = placeholders.map((ph) => {
    let dx = 0;
    if (ph.zone === 'spine') dx = delta / 2; // корешок растёт симметрично
    else if (ph.zone === 'front') dx = delta; // передняя зона целиком вправо
    // back и без зоны — без сдвига
    return dx === 0 ? ph : { ...ph, x_mm: ph.x_mm + dx };
  });

  return {
    width_mm: backWidthMm + realSpineWidthMm + frontWidthMm,
    height_mm: heightMm,
    spine_left_mm: backWidthMm,
    spine_right_mm: backWidthMm + realSpineWidthMm,
    placeholders: adjusted,
  };
}
