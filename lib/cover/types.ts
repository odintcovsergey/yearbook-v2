/**
 * Типы обложки альбома — Этап 1 (ТЗ docs/tz-cover-design.md).
 *
 * Обложка — единое полотно ЗАДНЯЯ + КОРЕШОК + ПЕРЕДНЯЯ. Корешок ПЛАВАЮЩИЙ:
 * его ширина считается из числа листов + пресета печати (см. ./spine.ts), а
 * не хранится в мастере.
 *
 * Модель данных строится РЯДОМ со старой системой обложек (albums.cover_mode /
 * cover_selections), не пересекаясь с ней. См. migrations/2026-06-02-cover-foundation.sql.
 */

import type { Placeholder } from '../album-builder/types';

/**
 * Что изображено на передней обложке.
 * - `portrait_photo` — портрет ученика (ПЕРСОНАЛЬНАЯ обложка, у каждого своя).
 * - `common_photo`   — общее фото класса (одинаковая у всех).
 * - `design_only`    — только дизайн без фото (галерея вариантов, см. gender_hint).
 *
 * Совпадает с CHECK на covers.cover_type и с CoverSectionConfig.cover_type.
 */
export type CoverType = 'portrait_photo' | 'common_photo' | 'design_only';

/**
 * Режим обложки на заказе (НОВАЯ система, albums.cover_layout_mode).
 * Не путать со старым albums.cover_mode (none/same/optional/required).
 * - `fixed`            — партнёр выбрал жёстко, родитель не меняет, шаг не показывается.
 * - `default_editable` — стоит дефолт, родитель может сменить / докупить персонализацию.
 * - `parent_choice`    — полная галерея доступных обложек на выбор родителю.
 */
export type CoverLayoutMode = 'fixed' | 'default_editable' | 'parent_choice';

/**
 * Подсказка пола для галереи design_only. Выбор РУЧНОЙ (родитель сам),
 * НЕ автоматически по полу ребёнка.
 */
export type CoverGenderHint = 'neutral' | 'boys' | 'girls';

/**
 * Канонические метки плейсхолдеров обложки (Script Labels из IDML).
 * Декор привязывается теми же суффиксами __over/__under (механизм уже есть).
 */
export type CoverPlaceholderName =
  // Передняя обложка — фото
  | 'cover_portrait'      // портрет ученика (персональный)
  | 'cover_common_photo'  // общее фото
  // Передняя обложка — текстовые подписи
  | 'cover_student_name'  // ФИО выпускника (children.full_name, персональная)
  | 'cover_school_name'   // название учебного заведения (albums.school_name)
  | 'cover_city'          // город (albums.city)
  | 'cover_year'          // год выпуска (albums.year)
  | 'cover_class'         // класс/группа (children.class / albums.classes)
  | 'cover_title'         // общее название/заголовок (albums.title)
  | 'cover_subtitle'      // подзаголовок (свободный)
  // Корешок
  | 'spine_text'          // текст на корешке (вертикальный)
  // Задняя обложка
  | 'back_logo'           // логотип фотостудии
  | 'back_contacts'       // контактная информация
  | 'back_common_photo'   // фрейм под фото на задней обложке
  | 'back_qr';            // QR-код (AR-фото, на будущее)

/**
 * Проекция строки таблицы `covers` (библиотека обложек-мастеров).
 */
export type Cover = {
  id: string;
  /** NULL = глобальная (библиотечная, видна всем). */
  tenant_id: string | null;
  is_global: boolean;
  /** NULL = библиотечная (не привязана к дизайну); иначе обложка этого template_set. */
  template_set_id: string | null;

  name: string;
  slug: string | null;

  cover_type: CoverType;

  /** Для галереи design_only. NULL для photo-обложек. */
  gender_hint: CoverGenderHint | null;
  variant_label: string | null;

  /**
   * Геометрия трёх зон (мм). Корешок здесь НЕ хранится — плавающий,
   * считается computeSpineWidthMm. base/bleed/загиб берутся из PrintSpec.
   */
  back_width_mm: number | null;
  front_width_mm: number | null;
  height_mm: number | null;

  placeholders: Placeholder[];
  background_url: string | null;

  is_published: boolean;
  sort_order: number;
  created_at: string;
};

/**
 * Тип листа внутри пресета печати: «без прослойки» / «+0.4» / «+0.7».
 * thickness_mm — полная толщина одного физического листа (бумага + прослойка).
 */
export type SheetType = {
  id: string;          // стабильный идентификатор (напр. 'plain' | 'spacer_04' | 'spacer_07')
  label: string;       // человекочитаемо («Без прослойки», «Прослойка 0.4 мм»)
  thickness_mm: number;
};

/**
 * Параметры печати для расчёта корешка и полей обложки
 * (config_presets.print_spec). ВСЕ числа — параметры; реальные значения
 * подставит Сергей позже (запрос у дизайнера/типографии).
 */
export type PrintSpec = {
  /** Конструктивный запас на сгибы корешка (мм). */
  spine_base_offset_mm: number;
  /** Вылет под обрез (мм). */
  bleed_mm: number;
  /** Выступ обложки за внутренний блок (мм). */
  cover_overhang_mm: number;
  /** Загиб на внутреннюю сторону (мм). */
  cover_fold_mm: number;
  /** Доступные типы листа (минимум один). */
  sheet_types: SheetType[];
  /** Тип листа по умолчанию (id из sheet_types). */
  default_sheet_type_id?: string;
};

/**
 * Проекция строки `cover_choices` — выбор родителя (новая система).
 */
export type CoverChoice = {
  id: string;
  child_id: string;
  cover_type: CoverType | null;
  /** Выбранный вариант обложки из библиотеки. */
  cover_id: string | null;
  /** Метка «родитель захотел докупить персонализацию». Деньги — вне системы. */
  paid_personalization: boolean;
  created_at: string;
};
