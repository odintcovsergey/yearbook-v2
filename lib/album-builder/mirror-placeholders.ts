/**
 * lib/album-builder/mirror-placeholders — авто-зеркало мастеров `page-any`
 * на правой странице разворота (ТЗ docs/tz-page-any-mirror.md).
 *
 * Зачем: мастера общего раздела и сеток нарисованы со смещением контента к
 * корешку (внутреннее поле ≠ внешнее). Левая и правая страницы зеркальны, но
 * движок кладёт один и тот же `page-any` мастер одинаково на обе стороны.
 * Значит смещение к корешку верно только слева, справа уезжает к внешнему краю.
 * Решение: на ПРАВОЙ странице отражаем геометрию мастера по вертикальной оси.
 *
 * Это чистая трансформация в памяти на этапе рендера — НЕ меняет БД, не
 * зависит от Supabase/storage/миграций. Применяется в ОДНОЙ общей точке
 * (этот модуль), которую дёргают оба рендера: канвас редактора (Konva) и
 * PDF-pipeline — чтобы превью = PDF. Содержимое (текст/шрифт/цвет/картинка)
 * НЕ зеркалится — только ПОЗИЦИЯ + align + rotation + offset привязанного декора.
 *
 * Порядок в пайплайне: зеркало — ФИНАЛЬНАЯ геометрическая трансформация,
 * ПОСЛЕ балансировки (applyBalanceFromData). Причина: `__pos__`-центрирование
 * пишет rule engine в ИСХОДНЫХ (не отражённых) координатах мастера и
 * mirror-неосознанно (lib/rule-engine/sections/shared.ts centerLastRowSlots).
 * Поэтому сначала балансируем в исходном пространстве, затем отражаем всё
 * целиком. Партнёрский `__halign__` применяет сам рендер поверх — его НЕ
 * трогаем (он в показанном, уже отражённом, пространстве).
 */

import type { PageType, RenderPlaceholder } from './types';

/** Сторона физической страницы при рендере. */
export type RenderSide = 'left' | 'right' | 'spread' | 'single';

/**
 * Отражает геометрию плейсхолдеров по вертикальной оси страницы.
 *
 * Все типы:
 *   - x_mm → pageWidthMm − x_mm − width_mm (отражение bounding box)
 *   - y_mm / width_mm / height_mm — без изменений
 *   - rotation_deg → −rotation_deg (если задано)
 * Text:
 *   - align: 'left' ↔ 'right'; 'center'/'justify' — без изменений
 *   - vertical_align / шрифт / размер / цвет / эффекты — без изменений
 * Photo:
 *   - fit / is_circle / corner_radius_mm / glow_* — без изменений
 * Decoration:
 *   - сам декор отражается тем же правилом по x_mm;
 *   - ПОСЛЕ отражения координат всех — offset_x_mm = deco.x_mm − base.x_mm
 *     (base ищется по attached_to); offset_y_mm без изменений;
 *   - foreground-декор (attached_to === '') offset не пересчитываем;
 *   - url / пиксели картинки декора НЕ переворачиваем.
 *
 * Чистая функция: возвращает новый массив, вход не мутирует.
 */
export function mirrorPlaceholders(
  placeholders: readonly RenderPlaceholder[],
  pageWidthMm: number,
): RenderPlaceholder[] {
  // Проход 1: отражаем x_mm + rotation + align у ВСЕХ плейсхолдеров (включая
  // декор). Поверхностный клон — оригинал мастера не мутируем.
  const mirrored: RenderPlaceholder[] = placeholders.map((p) => {
    const next = { ...p } as RenderPlaceholder;
    next.x_mm = pageWidthMm - p.x_mm - p.width_mm;
    if (next.rotation_deg !== undefined && next.rotation_deg !== null) {
      next.rotation_deg = -next.rotation_deg;
    }
    if (next.type === 'text') {
      if (next.align === 'left') next.align = 'right';
      else if (next.align === 'right') next.align = 'left';
      // 'center' / 'justify' — без изменений
    }
    return next;
  });

  // Проход 2: пересчитываем offset привязанного декора от НОВЫХ (отражённых)
  // позиций — так декор остаётся приклеенным к зеркальному слоту.
  const byLabel = new Map<string, RenderPlaceholder>();
  for (const p of mirrored) byLabel.set(p.label, p);

  for (const p of mirrored) {
    if (p.type !== 'decoration') continue;
    if (!p.attached_to) continue; // foreground — offset не трогаем
    const base = byLabel.get(p.attached_to);
    if (!base) continue; // сирота (база не найдена) — оставляем как есть
    p.offset_x_mm = p.x_mm - base.x_mm;
    // offset_y_mm без изменений
  }

  return mirrored;
}

/**
 * Применяет зеркало ТОЛЬКО когда страница правая и мастер `page-any`.
 *
 * Реализует приоритет ТЗ §3: явный правый мастер (page_type='page-right' —
 * E-*-Right, J-Quarter-Right и т.п.) > авто-зеркало (page-any) > левый как есть.
 * Явные `-Right` приходят с page_type !== 'page-any', поэтому под условие не
 * попадают и НЕ зеркалятся. Левые страницы и spread-мастера — тоже как есть.
 *
 * Для не-зеркального случая возвращает исходную ссылку (вызывающий код не
 * мутирует список).
 */
export function resolvePlaceholdersForSide(
  placeholders: readonly RenderPlaceholder[],
  side: RenderSide,
  pageType: PageType | null | undefined,
  pageWidthMm: number,
): RenderPlaceholder[] {
  if (side === 'right' && pageType === 'page-any') {
    return mirrorPlaceholders(placeholders, pageWidthMm);
  }
  return placeholders as RenderPlaceholder[];
}
