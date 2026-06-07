/**
 * Доменные типы фотопапки-тримо — отдельный продукт (product_type='photofolder').
 *
 * Структура (ТЗ Сергея 07.06.2026, см. memory project_photofolder):
 *   Разворот 1 (внешний), слева направо:  групповые / групповые / обложка папки
 *   Разворот 2 (внутренний), слева направо: классрук(+предметники) / сетка / сетка
 *   Сетка учеников ПЛАВАЮЩАЯ: при большом классе заходит и на панель учителей
 *   (panel_0), при небольшом — только панели 1-2. См. grid.ts (planFloatingGrid).
 *
 * Геометрию полотна (3 панели) разбирает computePanelZones в
 * lib/idml-converter/extract-geometry.ts (panel_0..panel_{n-1} слева направо).
 *
 * Метки переиспользуются из альбома (studentportrait_N, studentname_N,
 * teacherphoto_N, classphotoframe, collagephoto_N) + cover_* на обложке папки.
 *
 * Модуль чистый: без БД и без сети (как lib/cover и lib/album-builder).
 * Входные URL фото уже зарезолвлены вызывающей стороной.
 *
 * NB: реального IDML фотопапки пока нет — точные имена меток и форма мастера
 * провизорны, единая точка правки — LABELS ниже. Живой прогон когда дизайнер
 * пришлёт макет.
 */

import type { HeadTeacher, Photo, Student, Subject } from '../album-builder/types';

/**
 * Режим персонализации фотопапки (как у обложки):
 * - 'portrait_personal' — портрет персональный (на обложке папки, cover_portrait),
 *   остальное общее. По папке на ученика, отличаются только портретом. БАЗОВЫЙ.
 * - 'full_personal' — вся папка персональная (так делают другие фотографы).
 *   КАРКАС: в этой итерации ведёт себя как базовый, конкретные правила
 *   персонализации добавим когда придёт макет другого фотографа.
 */
export type PhotofolderMode = 'portrait_personal' | 'full_personal';

/**
 * Слот мастера фотопапки — минимум, нужный сборщику. Декуплировано от формы БД:
 * когда придёт реальный IDML, loader смаппит spread_templates → сюда.
 */
export type PhotofolderSlot = {
  /** Каноническое имя метки (lowercase), как в альбоме/обложке. */
  label: string;
  /**
   * Панель (0..n-1), куда попал слот по геометрии (computePanelZones,
   * zoneByPageIndex → 'panel_k'). undefined — слот вне панельной разметки.
   */
  panel?: number;
};

/**
 * Мастер одного разворота фотопапки (3 панели). Фотопапка-тримо = 2 мастера.
 */
export type PhotofolderMaster = {
  id: string;
  name: string;
  /** 0 = разворот 1 (внешний), 1 = разворот 2 (внутренний). */
  spread_index: number;
  slots: PhotofolderSlot[];
};

/**
 * Полный вход сборки фотопапки. Данные класса переиспользуют доменные типы
 * альбома (single source of truth), плюс групповые фото и общие тексты.
 */
export type PhotofolderInput = {
  mode: PhotofolderMode;
  /** Два мастера (разворот 1 и 2). Порядок не важен — берём по spread_index. */
  masters: PhotofolderMaster[];
  head_teacher: HeadTeacher | null;
  subjects: Subject[];
  students: Student[];
  /** Групповые фото класса (разворот 1, панели 0-1). */
  group_photos: Photo[];
  /** Общие тексты/фото (одинаковы для всех папок класса). */
  shared: PhotofolderShared;
};

/** Общее (одинаковое для всех папок класса) содержимое. */
export type PhotofolderShared = {
  title: string | null; // cover_title
  school_name: string | null; // cover_school_name
  city: string | null; // cover_city
  year: string | null; // cover_year
  classes: string | null; // cover_class
  /** Общее фото на обложку папки (cover_common_photo), не персональный портрет. */
  cover_common_photo_url: string | null;
};

/** Один собранный разворот фотопапки (аналог SpreadInstance альбома). */
export type PhotofolderSpread = {
  /** 0 = разворот 1, 1 = разворот 2. */
  spread_index: number;
  master_id: string | null;
  master_name: string | null;
  /** Метка → значение (URL фото или текст), как SpreadInstance.data. */
  data: Record<string, string | null>;
};

/** Одна собранная фотопапка. child_id=null — общая (нет учеников). */
export type PhotofolderInstance = {
  /** Ученик, чья это папка. null = общая на класс. */
  child_id: string | null;
  spreads: PhotofolderSpread[];
};

/** Коды предупреждений сборки (неблокирующие). */
export type PhotofolderWarningCode =
  | 'master_missing' // нет мастера разворота 1 или 2
  | 'no_head_teacher' // head_teacher=null, панель учителей пустая
  | 'no_group_photos' // group_photos пуст, групповые панели пустые
  | 'students_overflow' // учеников больше, чем вмещает сетка (с учётом плавающей)
  | 'students_empty'; // students пуст, сетка пустая

export type PhotofolderWarning = {
  code: PhotofolderWarningCode;
  detail: string;
};

/** Результат сборки фотопапки для класса. */
export type PhotofolderResult = {
  mode: PhotofolderMode;
  instances: PhotofolderInstance[];
  warnings: PhotofolderWarning[];
};

/**
 * Канонические имена меток (lowercase). ЕДИНАЯ точка правки имён до прихода
 * реального IDML. Если дизайнер назовёт слоты иначе — меняем здесь.
 */
export const LABELS = {
  // ── обложка папки (разворот 1, панель 2) ──
  coverPortrait: 'cover_portrait', // персональный портрет ученика (base mode)
  coverCommonPhoto: 'cover_common_photo',
  coverTitle: 'cover_title',
  coverSchoolName: 'cover_school_name',
  coverCity: 'cover_city',
  coverYear: 'cover_year',
  coverClass: 'cover_class',
  coverStudentName: 'cover_student_name', // ФИО ученика (персональное)
  // ── классрук (разворот 2, панель учителей) ──
  headTeacherName: 'headteachername',
  headTeacherRole: 'headteacherrole',
  headTextFrame: 'headtextframe',
  headTeacherPhoto: 'headteacherphoto',
} as const;

/** Регэксп индексированной метки вида `<base>_<N>` (1-based). */
export const INDEXED = {
  /** Групповое фото: classphotoframe (одиночное) или collagephoto_N (множ.). */
  groupPhoto: /^(?:classphotoframe|collagephoto_(\d+)|groupphoto_(\d+))$/,
  studentPortrait: /^studentportrait_(\d+)$/,
  studentName: /^studentname_(\d+)$/,
  teacherPhoto: /^teacherphoto_(\d+)$/,
  teacherName: /^teachername_(\d+)$/,
  teacherRole: /^teacherrole_(\d+)$/,
} as const;
