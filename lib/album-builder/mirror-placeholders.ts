/**
 * lib/album-builder/mirror-placeholders — авто-зеркало мастеров `page-any`
 * на правой странице разворота (ТЗ docs/tz-page-any-mirror.md).
 *
 * Зачем: мастера общего раздела и сеток нарисованы со смещением контента к
 * корешку (внутреннее поле ≠ внешнее). Левая и правая страницы зеркальны, но
 * движок кладёт один и тот же `page-any` мастер одинаково на обе стороны.
 * Значит смещение к корешку верно только слева, справа уезжает к внешнему краю.
 * Решение: на ПРАВОЙ странице сдвигаем весь блок контента к корешку (влево),
 * сохраняя тот же отступ от корешка, что был слева.
 *
 * ВАЖНО (доработка 16.06.2026): это НЕ «честное зеркало» по вертикальной оси.
 * Честное зеркало (x → W − x − w поэлементно) переворачивало бы и порядок
 * ячеек — слот №1 уезжал бы к корешку, №N к внешнему краю, чтение «задом
 * наперёд». Нужно другое: блок сдвигается целиком, но порядок чтения 1→N и
 * внутренняя раскладка (выравнивание текста, поворот) НЕ меняются. Поэтому
 * применяем ОДИН общий горизонтальный сдвиг ко всем плейсхолдерам так, чтобы
 * bounding box блока встал зеркально относительно центра страницы.
 *
 * Это чистая трансформация в памяти на этапе рендера — НЕ меняет БД, не
 * зависит от Supabase/storage/миграций. Применяется в ОДНОЙ общей точке
 * (этот модуль), которую дёргают оба рендера: канвас редактора (Konva) и
 * PDF-pipeline — чтобы превью = PDF. Содержимое (текст/шрифт/цвет/картинка/
 * align/rotation) НЕ трогается — меняется только горизонтальная позиция (x_mm).
 *
 * Порядок в пайплайне: зеркало — ФИНАЛЬНАЯ геометрическая трансформация,
 * ПОСЛЕ балансировки (applyBalanceFromData). Причина: `__pos__`-центрирование
 * пишет rule engine в ИСХОДНЫХ координатах мастера (lib/rule-engine/sections/
 * shared.ts centerLastRowSlots). Поэтому сначала балансируем в исходном
 * пространстве, затем сдвигаем блок целиком. Партнёрский `__halign__`
 * применяет сам рендер поверх — его НЕ трогаем.
 */

import type { PageType, RenderPlaceholder } from './types';

/** Сторона физической страницы при рендере. */
export type RenderSide = 'left' | 'right' | 'spread' | 'single';

/**
 * Сдвигает весь блок плейсхолдеров к корешку для правой страницы, сохраняя
 * внутреннюю раскладку и порядок чтения 1→N.
 *
 * Логика: считаем bounding box блока [minX, maxX] по горизонтали. Зеркальное
 * положение блока относительно центра страницы → новый левый край = W − maxX.
 * Значит общий сдвиг = (W − maxX) − minX = W − minX − maxX, и КАЖДЫЙ элемент
 * получает x += сдвиг. Это чистый горизонтальный перенос:
 *   - x_mm → x_mm + сдвиг (одинаковый для всех);
 *   - y_mm / width_mm / height_mm / rotation_deg — без изменений;
 *   - align / vertical_align / шрифт / размер / цвет / эффекты — без изменений;
 *   - photo: fit / is_circle / corner_radius_mm / glow_* — без изменений;
 *   - decoration: тоже сдвигается на ту же величину, поэтому offset_x_mm
 *     относительно базы СОХРАНЯЕТСЯ автоматически (база и декор едут вместе);
 *     url / пиксели картинки декора не трогаем.
 *
 * Bounding box считаем по НЕ-декоративным слотам (фото/текст) — это «блок
 * контента». Декор приклеен и едет за блоком. Если слотов нет (только декор) —
 * fallback на все плейсхолдеры. Пустой вход → сдвиг 0.
 *
 * Симметричный мастер (блок по центру) → сдвиг 0 (math no-op), как и должно.
 *
 * Чистая функция: возвращает новый массив, вход не мутирует.
 */
export function mirrorPlaceholders(
  placeholders: readonly RenderPlaceholder[],
  pageWidthMm: number,
): RenderPlaceholder[] {
  if (placeholders.length === 0) return [];

  // bounding box блока контента: слоты (фото/текст) задают границы; если их
  // нет — берём все плейсхолдеры (например, мастер из одного декора).
  const slots = placeholders.filter((p) => p.type !== 'decoration');
  const bboxSource = slots.length > 0 ? slots : placeholders;

  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of bboxSource) {
    if (p.x_mm < minX) minX = p.x_mm;
    if (p.x_mm + p.width_mm > maxX) maxX = p.x_mm + p.width_mm;
  }

  // Сдвиг ставит блок зеркально относительно центра страницы: новый левый край
  // блока = W − maxX, значит дельта = (W − maxX) − minX.
  const shift = pageWidthMm - minX - maxX;

  // Один общий перенос по x для ВСЕХ (включая декор). Поверхностный клон —
  // оригинал мастера не мутируем. Всё остальное (align, rotation, offset
  // декора) сохраняется как есть: блок едет целиком, раскладка неизменна.
  return placeholders.map((p) => ({ ...p, x_mm: p.x_mm + shift }) as RenderPlaceholder);
}

/**
 * Позиционирует блок контента на странице (модель «поля», заменяет зеркало для
 * дизайнов, где задан `spine_margin_mm`).
 *
 * Идея (ТЗ п.5, 16.06.2026): не доверять абсолютным координатам дизайнера, а
 * ставить блок системой. Дизайнер рисует контент как угодно (часто прижат к
 * одному краю под зеркало) — система ставит его как надо.
 *
 * Правка 17.06.2026 (по идее Сергея): блок ЦЕНТРИРУЕТСЯ по странице. `spineMarginMm`
 * — это МИНИМАЛЬНЫЙ зазор у КОРЕШКА (гарантия), а не точное поле. Так:
 *   - обычный блок (уже центрированного зазора хватает) → ставится по центру;
 *   - очень широкий блок, у которого центрирование дало бы у корешка < margin →
 *     сдвигается к внешнему краю, чтобы у корешка осталось ровно `spineMarginMm`.
 * Зачем центр: коллаж/портрет, нарисованный у одного края макета, на зеркальной
 * стороне иначе прижимался бы к внешнему краю (баг 17.06). Центр выглядит ровно
 * на ОБЕИХ страницах. Парадная с крупным портретом тоже встаёт по центру.
 * Внутренняя раскладка/порядок/выравнивание не меняются (чистый горизонтальный
 * перенос → offset привязанного декора сохраняется сам). Клампим по краям.
 *
 * bbox считаем по слотам (фото/текст); если их нет — по всем плейсхолдерам.
 */
function positionBlockBySpine(
  placeholders: readonly RenderPlaceholder[],
  side: 'left' | 'right',
  pageWidthMm: number,
  spineMarginMm: number,
): RenderPlaceholder[] {
  if (placeholders.length === 0) return [];
  const slots = placeholders.filter((p) => p.type !== 'decoration');
  const src = slots.length > 0 ? slots : placeholders;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of src) {
    if (p.x_mm < minX) minX = p.x_mm;
    if (p.x_mm + p.width_mm > maxX) maxX = p.x_mm + p.width_mm;
  }
  const blockW = maxX - minX;

  // Целевой левый край блока: ЦЕНТР страницы.
  let targetMinX = (pageWidthMm - blockW) / 2;
  // Гарантируем минимум spineMarginMm у корешка (бьётся только для очень широких
  // блоков, где центрирование подвело бы блок к корешку ближе отступа).
  //   left: корешок справа → правый край ≤ W − margin → targetMinX ≤ W − margin − blockW.
  //   right: корешок слева → левый край ≥ margin → targetMinX ≥ margin.
  if (side === 'left') {
    const maxTargetMinX = pageWidthMm - spineMarginMm - blockW;
    if (targetMinX > maxTargetMinX) targetMinX = maxTargetMinX;
  } else {
    if (targetMinX < spineMarginMm) targetMinX = spineMarginMm;
  }

  let shift = targetMinX - minX;

  // Кламп: блок не должен выходить за пределы страницы [0, W].
  const newMin = minX + shift;
  const newMax = maxX + shift;
  if (newMin < 0) shift -= newMin;
  else if (newMax > pageWidthMm) shift -= newMax - pageWidthMm;

  return placeholders.map((p) => ({ ...p, x_mm: p.x_mm + shift }) as RenderPlaceholder);
}

/**
 * Выбирает горизонтальное позиционирование плейсхолдеров под сторону страницы.
 *
 * Две модели:
 *  1. **Поля** (`spineMarginMm` задан у дизайна) — система ставит блок с этим
 *     полем у корешка на ЛЮБОЙ стороне (left/right), для всех не-spread
 *     мастеров. Игнорирует абсолютный сдвиг дизайнера. Заменяет зеркало.
 *  2. **Авто-зеркало** (`spineMarginMm` == null, legacy) — отражает блок
 *     page-any мастера на правой странице (см. mirrorPlaceholders). Явные
 *     `-Left/-Right` и spread — как есть.
 *
 * Для не-применимых случаев возвращает исходную ссылку (вызывающий не мутирует).
 */
export function resolvePlaceholdersForSide(
  placeholders: readonly RenderPlaceholder[],
  side: RenderSide,
  pageType: PageType | null | undefined,
  pageWidthMm: number,
  spineMarginMm?: number | null,
): RenderPlaceholder[] {
  // Модель «поля»: применяется на левой/правой стороне ко всем не-spread
  // мастерам, если у дизайна задан отступ от корешка.
  if (
    spineMarginMm != null &&
    (side === 'left' || side === 'right') &&
    pageType !== 'spread'
  ) {
    return positionBlockBySpine(placeholders, side, pageWidthMm, spineMarginMm);
  }
  // Legacy авто-зеркало page-any на правой.
  if (side === 'right' && pageType === 'page-any') {
    return mirrorPlaceholders(placeholders, pageWidthMm);
  }
  return placeholders as RenderPlaceholder[];
}
