/**
 * РЭ.28: подготовка ПЛАНА клонирования template_set'а с новыми размерами.
 *
 * Главная функция инженерной части фазы. Не выполняет операций в БД —
 * только готовит структуры данных. API подэтапа 28.3 принимает ClonePlan
 * и делает INSERT'ы в транзакции.
 *
 * Логика (см. spec §3.5):
 *  1. Считаем scale_x, scale_y из соотношения page_*_mm.
 *  2. checkAspectCompatibility — если 'blocked', throw.
 *  3. Перебираем мастеров, для каждого:
 *     - width_mm, height_mm × scale → roundMmToPx
 *     - placeholders.map(p => resizePlaceholder(p, scale_x, scale_y))
 *  4. Пересчитываем spread_width/height_mm с учётом facing_pages.
 *  5. bleed_mm — из формы (если задано) или из source. Округляем.
 *  6. Все поля результата подписываются ClonePlan для API.
 *
 * Что НЕ resize'ится:
 *  - rotation_deg, label, type, fit, original_label, required — копируются как есть
 *  - print_type — копируется без изменений (РЭ.27 живёт на уровне альбома)
 *  - background_url (если есть) — копируется как URL, не дублируется файл
 *  - всё что в spread_templates кроме width_mm/height_mm/placeholders
 *
 * Чистая функция, без зависимостей от Supabase.
 */

import { roundMmToPx } from './round-to-pixels';
import { resizePlaceholder } from './resize-placeholder';
import {
  checkAspectCompatibility,
  type AspectCompatibilityResult,
} from './aspect-compatibility';

/**
 * Подмножество template_set'а, которое нужно для resize'а.
 * Полная запись приходит из БД с дополнительными полями (created_at,
 * updated_at, slug, и т.д.) — они в clone-логике не участвуют, но
 * прокидываются в результат через spread.
 */
export type SourceTemplateSet = {
  id: string;
  name: string;
  page_width_mm: number;
  page_height_mm: number;
  spread_width_mm: number;
  spread_height_mm: number;
  bleed_mm: number | null;
  print_type: string;
  facing_pages: boolean | null;
  page_binding: string | null;
  description: string | null;
};

/**
 * Подмножество мастера для resize'а. Реальный spread_templates имеет
 * 25 колонок — все, кроме id и template_set_id и created_at, прокидываем
 * через spread без обработки.
 */
export type SourceMaster = {
  name: string;
  width_mm: number;
  height_mm: number;
  placeholders: unknown[]; // массив объектов с x_mm/y_mm/width_mm/height_mm
  [key: string]: unknown;
};

export type CloneRequest = {
  source_template_set: SourceTemplateSet;
  source_masters: SourceMaster[];
  /** Что задал партнёр в форме. */
  new_name: string;
  new_page_width_mm: number;
  new_page_height_mm: number;
  /**
   * Опциональный bleed_mm. Если не задан (undefined) — используем
   * source.bleed_mm. null значит «партнёр явно убрал припуск».
   */
  new_bleed_mm?: number | null;
};

/**
 * Готовая запись template_set для INSERT в БД (id и FK заполнит API).
 */
export type ClonedTemplateSetRecord = {
  name: string;
  parent_template_set_id: string;
  page_width_mm: number;
  page_height_mm: number;
  spread_width_mm: number;
  spread_height_mm: number;
  bleed_mm: number | null;
  print_type: string;
  is_global: false;
  facing_pages: boolean | null;
  page_binding: string | null;
  description: string | null;
  slug: null;
};

/**
 * Готовая запись мастера для INSERT (template_set_id и id заполнит API).
 * Все поля исходного мастера, кроме изменённых width/height/placeholders.
 */
export type ClonedMasterRecord = SourceMaster & {
  // те же поля что в source, но resized
};

export type ClonePlan = {
  new_template_set: ClonedTemplateSetRecord;
  new_masters: ClonedMasterRecord[];
  resize_info: {
    scale_x: number;
    scale_y: number;
    aspect_check: AspectCompatibilityResult;
    masters_count: number;
    placeholders_resized: number;
  };
};

/**
 * Главная функция фазы.
 *
 * Throws если aspect_check.level === 'blocked' (партнёру нужно
 * выбрать другие размеры или другой исходник).
 */
export function prepareTemplateSetClone(request: CloneRequest): ClonePlan {
  const src = request.source_template_set;
  const oldW = src.page_width_mm;
  const oldH = src.page_height_mm;
  const newW = request.new_page_width_mm;
  const newH = request.new_page_height_mm;

  if (oldW <= 0 || oldH <= 0) {
    throw new Error(
      `prepareTemplateSetClone: source page sizes invalid (${oldW}x${oldH})`,
    );
  }
  if (newW <= 0 || newH <= 0) {
    throw new Error(
      `prepareTemplateSetClone: target page sizes invalid (${newW}x${newH})`,
    );
  }
  if (!request.new_name || request.new_name.trim().length === 0) {
    throw new Error('prepareTemplateSetClone: new_name is required');
  }

  // 1. Совместимость пропорций.
  const aspectCheck = checkAspectCompatibility(oldW, oldH, newW, newH);
  if (aspectCheck.level === 'blocked') {
    throw new Error(
      `prepareTemplateSetClone: aspect incompatible — ${aspectCheck.message}`,
    );
  }

  // 2. Коэффициенты scale.
  const scaleX = newW / oldW;
  const scaleY = newH / oldH;

  // 3. Resize мастеров.
  let placeholdersResized = 0;
  const newMasters: ClonedMasterRecord[] = request.source_masters.map((m) => {
    const placeholders = Array.isArray(m.placeholders) ? m.placeholders : [];
    const resizedPlaceholders = placeholders.map((p) => {
      placeholdersResized += 1;
      // Безопасно: если placeholder не имеет x_mm/y_mm/width_mm/height_mm —
      // resizePlaceholder вернёт NaN в этих полях, что упадёт на CHECK
      // ограничениях БД. Это нормально — плохой placeholder не должен
      // попасть в клон.
      return resizePlaceholder(p as Parameters<typeof resizePlaceholder>[0], scaleX, scaleY);
    });
    return {
      ...m,
      width_mm: roundMmToPx(m.width_mm * scaleX),
      height_mm: roundMmToPx(m.height_mm * scaleY),
      placeholders: resizedPlaceholders,
    };
  });

  // 4. spread_width_mm / spread_height_mm — пересчёт с учётом facing_pages.
  // Если facing_pages=true (стандарт) — разворот это две страницы рядом:
  //   spread_width = page_width * 2
  // Если facing_pages=false (одностраничный режим) — разворот = страница:
  //   spread_width = page_width
  // spread_height всегда = page_height.
  const facingPages = src.facing_pages !== false; // null/true → true (дефолт)
  const newSpreadWidth = roundMmToPx(facingPages ? newW * 2 : newW);
  const newSpreadHeight = roundMmToPx(newH);

  // 5. bleed_mm — приоритет ввода партнёра.
  let newBleed: number | null;
  if (request.new_bleed_mm === undefined) {
    newBleed = src.bleed_mm;
  } else if (request.new_bleed_mm === null) {
    newBleed = null;
  } else {
    newBleed = roundMmToPx(request.new_bleed_mm);
  }

  // 6. Округление page sizes (вход партнёра обычно целые мм, но через
  //    roundMmToPx гарантируем кратность пикселю).
  const newPageWidthRounded = roundMmToPx(newW);
  const newPageHeightRounded = roundMmToPx(newH);

  const newTemplateSet: ClonedTemplateSetRecord = {
    name: request.new_name.trim(),
    parent_template_set_id: src.id,
    page_width_mm: newPageWidthRounded,
    page_height_mm: newPageHeightRounded,
    spread_width_mm: newSpreadWidth,
    spread_height_mm: newSpreadHeight,
    bleed_mm: newBleed,
    print_type: src.print_type,
    is_global: false,
    facing_pages: src.facing_pages,
    page_binding: src.page_binding,
    description: src.description,
    slug: null,
  };

  return {
    new_template_set: newTemplateSet,
    new_masters: newMasters,
    resize_info: {
      scale_x: scaleX,
      scale_y: scaleY,
      aspect_check: aspectCheck,
      masters_count: newMasters.length,
      placeholders_resized: placeholdersResized,
    },
  };
}
