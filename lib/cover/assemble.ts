/**
 * Движок сборки обложек — Этап 4 (ТЗ docs/tz-cover-design.md).
 *
 * Чистая логика, без БД: по режиму обложки + выбору родителя решает, какая
 * обложка (вариант-мастер + тип) у каждого ученика, и раскладывает данные по
 * меткам (cover_portrait / cover_title / spine_text / back_*), как это делает
 * сборка разворотов (SpreadInstance.data).
 *
 * Источник данных (selections.portrait_cover, cover_choices, covers) читается
 * в load-covers.ts и подаётся сюда уже разрезолвленным.
 */

import type { Cover, CoverLayoutMode, CoverType } from './types';

/** Данные одного ученика для сборки его обложки. */
export type CoverStudentInput = {
  child_id: string;
  full_name: string;
  class: string;
  /** URL альбомного портрета (selections.portrait_page). */
  album_portrait_url: string | null;
  /**
   * URL отдельного фото под обложку (selections.portrait_cover), если родитель
   * выбрал своё. Приоритетнее альбомного портрета.
   */
  cover_portrait_override_url: string | null;
  /** Выбор родителя из cover_choices (новая система). null = не выбирал. */
  choice: CoverChoiceInput | null;
};

/** Выбор родителя по обложке (проекция cover_choices). */
export type CoverChoiceInput = {
  cover_type: CoverType | null;
  cover_id: string | null;
};

/** Конфиг обложки на заказе (проекция cover-полей albums + библиотека). */
export type CoverAssemblyConfig = {
  mode: CoverLayoutMode;
  default_type: CoverType;
  /** Какие обложки показывать/использовать. Пустой = вся библиотека. */
  available_cover_ids: string[];
  /** Библиотека доступных cover-мастеров (уже отфильтрована global+tenant+published). */
  library: Cover[];
};

/** Общее (одинаковое для всех) содержимое обложки: тексты и общие фото. */
export type CoverSharedContent = {
  title: string | null;       // cover_title
  subtitle: string | null;    // cover_subtitle (год/класс)
  spine_text: string | null;  // spine_text
  common_photo_url: string | null;      // cover_common_photo
  back_common_photo_url: string | null; // back_common_photo
  back_logo_url: string | null;         // back_logo
  back_contacts: string | null;         // back_contacts
};

/** Результат сборки одной обложки (аналог SpreadInstance). */
export type CoverInstance = {
  /** Ученик, которому принадлежит обложка. null = общая (одна на класс). */
  child_id: string | null;
  /** Выбранный cover-мастер из библиотеки. null = подходящей обложки нет. */
  cover_id: string | null;
  cover_name: string | null;
  cover_type: CoverType;
  /** Метка → значение (URL фото или текст), как SpreadInstance.data. */
  data: Record<string, string | null>;
};

/**
 * Доступна ли обложка по списку available_cover_ids (пустой = все доступны).
 */
function isAvailable(cover: Cover, availableIds: string[]): boolean {
  return availableIds.length === 0 || availableIds.includes(cover.id);
}

/**
 * Выбирает дефолтный cover-мастер заданного типа: первый доступный и
 * опубликованный, по sort_order. null если такого нет в библиотеке.
 */
function pickDefaultCover(
  type: CoverType,
  config: CoverAssemblyConfig,
): Cover | null {
  const candidates = config.library
    .filter((c) => c.cover_type === type && isAvailable(c, config.available_cover_ids))
    .sort((a, b) => a.sort_order - b.sort_order);
  return candidates[0] ?? null;
}

/**
 * Определяет тип и cover-мастер для одного ученика с учётом режима.
 * - fixed: выбор родителя ИГНОРИРУЕТСЯ — всем дефолтный тип и мастер партнёра.
 * - default_editable / parent_choice: учитываем выбор родителя, иначе дефолт.
 */
export function resolveCoverForStudent(
  student: CoverStudentInput,
  config: CoverAssemblyConfig,
): { type: CoverType; cover: Cover | null } {
  // В fixed режиме родитель не выбирает — игнорируем choice.
  const choice = config.mode === 'fixed' ? null : student.choice;

  const type = choice?.cover_type ?? config.default_type;

  // Явный выбор варианта родителем — если он валиден, доступен и того же типа.
  if (choice?.cover_id) {
    const chosen = config.library.find((c) => c.id === choice.cover_id);
    if (
      chosen &&
      chosen.cover_type === type &&
      isAvailable(chosen, config.available_cover_ids)
    ) {
      return { type, cover: chosen };
    }
  }

  return { type, cover: pickDefaultCover(type, config) };
}

/**
 * Раскладывает данные по меткам обложки для конкретного ученика и типа.
 * Заполняет только известные семантические метки; декоративный текст
 * (default_text) и неизвестные метки оставляет рендеру.
 */
export function fillCoverData(
  cover: Cover | null,
  type: CoverType,
  student: CoverStudentInput | null,
  shared: CoverSharedContent,
): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  if (!cover) return data;

  // Портрет на обложку: override (родительское фото) ?? альбомный портрет.
  const portraitUrl =
    student?.cover_portrait_override_url ?? student?.album_portrait_url ?? null;

  for (const ph of cover.placeholders) {
    const label = ph.label.toLowerCase();
    switch (label) {
      case 'cover_portrait':
        // Портрет только для персональных обложек (portrait_photo).
        data[ph.label] = type === 'portrait_photo' ? portraitUrl : null;
        break;
      case 'cover_common_photo':
        data[ph.label] = shared.common_photo_url;
        break;
      case 'cover_title':
        data[ph.label] = shared.title;
        break;
      case 'cover_subtitle':
        data[ph.label] = shared.subtitle;
        break;
      case 'spine_text':
        data[ph.label] = shared.spine_text;
        break;
      case 'back_common_photo':
        data[ph.label] = shared.back_common_photo_url;
        break;
      case 'back_logo':
        data[ph.label] = shared.back_logo_url;
        break;
      case 'back_contacts':
        data[ph.label] = shared.back_contacts;
        break;
      // back_qr и прочее — на будущее/рендеру, не заполняем здесь.
      default:
        break;
    }
  }
  return data;
}

/**
 * Собирает обложки для всего класса.
 *
 * Правило персонализации (ТЗ):
 * - portrait_photo → по обложке на ученика (у каждого свой портрет).
 * - common_photo / design_only в режиме fixed → ОДНА общая обложка (child_id=null).
 * - в режимах default_editable / parent_choice → всегда по ученику (выбор у
 *   каждого может отличаться — смесь типов нормальна).
 */
export function assembleCovers(
  students: CoverStudentInput[],
  config: CoverAssemblyConfig,
  shared: CoverSharedContent,
): CoverInstance[] {
  // Общая обложка: fixed + не персональный тип → одна на всех.
  if (config.mode === 'fixed' && config.default_type !== 'portrait_photo') {
    const { type, cover } = resolveCoverForStudent(
      { ...EMPTY_STUDENT, choice: null },
      config,
    );
    return [
      {
        child_id: null,
        cover_id: cover?.id ?? null,
        cover_name: cover?.name ?? null,
        cover_type: type,
        data: fillCoverData(cover, type, null, shared),
      },
    ];
  }

  // Иначе — по обложке на ученика.
  return students.map((student) => {
    const { type, cover } = resolveCoverForStudent(student, config);
    return {
      child_id: student.child_id,
      cover_id: cover?.id ?? null,
      cover_name: cover?.name ?? null,
      cover_type: type,
      data: fillCoverData(cover, type, student, shared),
    };
  });
}

const EMPTY_STUDENT: CoverStudentInput = {
  child_id: '',
  full_name: '',
  class: '',
  album_portrait_url: null,
  cover_portrait_override_url: null,
  choice: null,
};
