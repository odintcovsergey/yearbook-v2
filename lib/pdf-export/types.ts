/**
 * Публичные типы PDF-экспорта (фаза 3).
 *
 * Контекст: партнёр в Обзоре альбома выбирает профиль и жмёт
 * «Экспортировать». Endpoint POST /api/layout?action=export (фаза 3.6)
 * вызывает `exportAlbumPdf(input)` из `lib/pdf-export/index.ts`. Тот
 * возвращает PDF Bytes + warnings, endpoint upload'ит в YC и сохраняет
 * запись в `album_exports`.
 *
 * См. docs/phase-3-spec.md §3.4, §4.5.
 */

import type {
  SpreadInstance,
  SpreadTemplate,
  TemplateSet,
  AlbumInput,
} from '@/lib/album-builder/types';

// ─── ExportProfile (из БД export_profiles) ────────────────────────────────

export type ExportPurpose = 'typography' | 'preview';
export type ExportFormat = 'pdf' | 'jpg-pages';
export type ExportQuality = 'high' | 'medium' | 'preview';
export type ExportColorMode = 'rgb' | 'cmyk';
export type ExportPagesMode =
  | 'all_common'
  | 'per_student'
  | 'per_student_individual_only';

/**
 * Профиль экспорта — конфигурация всех параметров рендера.
 * 1:1 маппинг на строку из таблицы `export_profiles`.
 *
 * 3 глобальных seed-профиля:
 * - okeybook-print          — типография, 300 dpi, bleed, ~30-80 МБ
 * - okeybook-client-preview — для клиента, 150 dpi, без bleed, ~5-10 МБ
 * - okeybook-per-student    — STUB (фаза 3.A), endpoint вернёт 501
 */
export type ExportProfile = {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  is_default: boolean;
  purpose: ExportPurpose;
  format: ExportFormat;
  quality: ExportQuality;
  include_bleed: boolean;
  color_mode: ExportColorMode;
  dpi: number;
  jpeg_quality: number;
  filename_template: string;
  pages_mode: ExportPagesMode;
  target_size_mb: number | null;
  enabled: boolean;
};

// ─── Альбом-input для экспорта ────────────────────────────────────────────

/**
 * Вход в exportAlbumPdf — всё что нужно собрать PDF.
 *
 * `albumInput` — тот же тип что builder использует в фазе 1 (children,
 * teachers, photos, common). Photo embedder из фазы 3.4 использует
 * `albumInput.photos` для lookup'а оригиналов по filename.
 */
export type AlbumExportInput = {
  album: {
    id: string;
    name: string;
    tenant_id: string;
  };
  layout: {
    spreads: SpreadInstance[];
    has_user_edits: boolean;
  };
  templateSet: TemplateSet;
  albumInput: AlbumInput;
  profile: ExportProfile;
};

// ─── Warnings ─────────────────────────────────────────────────────────────

/**
 * Коды warning'ов от PDF builder'а. Все неблокирующие — экспорт
 * продолжается с fallback'ом или пропуском проблемного элемента.
 *
 * - `photo_not_found`     — photo_id из layout'а не найден в albumInput.photos
 * - `no_original`         — для quality='high' не найден оригинал по filename,
 *                           использован selection WebP fallback
 * - `font_not_found`      — запрошенное семейство/вес не в FontRegistry,
 *                           использован Noto Serif Regular fallback
 * - `text_overflow`       — текст не влезает даже на min_size_pt с line wrap,
 *                           обрезан
 * - `image_decode_failed` — sharp не смог декодировать image (битый файл),
 *                           слот пропущен
 * - `template_not_found`  — `template_id` из spread не найден в templateSet,
 *                           разворот пропущен
 * - `placeholder_off_page` — placeholder.x_mm + width_mm выходит за границы
 *                            страницы (с учётом bleed), отрисован в clip'е
 */
export type PdfWarningCode =
  | 'photo_not_found'
  | 'no_original'
  | 'font_not_found'
  | 'text_overflow'
  | 'image_decode_failed'
  | 'template_not_found'
  | 'placeholder_off_page';

export type PdfWarning = {
  code: PdfWarningCode;
  detail: string;
  /** Опциональный ref к месту: spread_index, label, photo_id и т.д. */
  context?: Record<string, string | number>;
};

// ─── Результат экспорта ──────────────────────────────────────────────────

export type ExportResult = {
  /** Сырые байты готового PDF, готовы к upload в YC. */
  pdfBytes: Uint8Array;
  /** Количество страниц в PDF (для записи в album_exports.page_count). */
  pageCount: number;
  /** Warning'и накопленные за время экспорта. */
  warnings: PdfWarning[];
};

// ─── Box geometry (mediaBox / trimBox / bleedBox) ────────────────────────

/**
 * Размеры страницы PDF в мм. mediaBox = trim + bleed × 2 со всех сторон.
 *
 * Для okeybook-default (после миграции 3.1):
 *   trim_w  = 226 мм, trim_h  = 288 мм
 *   bleed_mm = 5
 *   media_w = 236 мм, media_h = 298 мм
 */
export type PageBoxes = {
  trim_width_mm: number;
  trim_height_mm: number;
  bleed_mm: number;
  /** mediaBox = trim + bleed × 2. */
  media_width_mm: number;
  media_height_mm: number;
};

// ─── Re-exports из album-builder для удобства потребителей ────────────────

export type {
  SpreadInstance,
  SpreadTemplate,
  TemplateSet,
  AlbumInput,
} from '@/lib/album-builder/types';
