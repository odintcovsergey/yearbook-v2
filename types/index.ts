export type CoverMode = 'none' | 'same' | 'optional' | 'required'
export type PhotoType = 'portrait' | 'group' | 'teacher'
export type SelectionType = 'portrait_page' | 'portrait_cover' | 'group'
export type CoverOption = 'none' | 'same' | 'other'

/**
 * РЭ.27: тип переплёта альбома. Хранится в albums.print_type.
 * - layflat — твёрдые листы (фото может идти на разворот, разворот плоский).
 * - soft — мягкие листы (фото не пересекает корешок, первая страница
 *   правая, последняя — левая).
 */
export type PrintType = 'layflat' | 'soft'

export interface Album {
  id: string
  title: string
  classes: string[]
  cover_mode: CoverMode
  cover_price: number
  deadline: string | null
  /**
   * РЭ.25: включать ли не-заказчиков (children.is_purchased=false) в
   * персональные страницы альбома. Default false (строгое поведение —
   * не-заказчики без личной страницы). При true фильтр выключен.
   * Опциональное поле: старый код, не знающий о нём, продолжает работать.
   */
  include_non_purchasers?: boolean
  /**
   * РЭ.27: тип переплёта альбома. NULL означает «использовать
   * print_type из связанного пресета» (fallback). Опциональное поле
   * для бэк-совместимости — старые альбомы могут не иметь значения,
   * engine применит resolvePrintType(album, preset).
   */
  print_type?: PrintType | null
  /**
   * РЭ.40: стратегия распределения учеников по grid-страницам.
   * Применяется только к density='mini' и 'light' (где есть grid-сетка
   * с одним мастером на полную страницу). Для 'medium', 'standard',
   * 'universal' поле игнорируется.
   *
   * Режимы:
   * - 'greedy' — жадное распределение (12+12+6), может симметризовать
   *   хвост 1 (legacy-поведение)
   * - 'equalize' — всегда равномерно (10+10+10), даже если есть фото
   *   для combined-tail
   * - 'auto' — умный алгоритм: combined+equalize если фото и подходит,
   *   иначе чистый equalize
   *
   * Default 'auto' для новых и существующих альбомов (миграция
   * 2026-05-25-albums-student-distribution.sql).
   */
  student_distribution?: 'auto' | 'equalize' | 'greedy'
}

export interface Child {
  id: string
  album_id: string
  full_name: string
  class: string
  access_token: string
  submitted_at: string | null
  /**
   * РЭ.25: заказывает ли этот ребёнок альбом. По умолчанию true.
   * Если false и albums.include_non_purchasers=false — ребёнок НЕ
   * получает персональную страницу. Меняется фотографом в /app
   * и родителем в /[token].
   * Опциональное поле для бэк-совместимости с местами, где SELECT
   * ещё не расширен.
   */
  is_purchased?: boolean
}

export interface Teacher {
  id: string
  album_id: string
  full_name: string | null
  position: string | null
  submitted_at: string | null
}

export interface Photo {
  id: string
  filename: string
  storage_path: string
  type: PhotoType
  url: string
  thumb: string
  locked?: boolean  // для групповых — занято другим
}

export interface ParentSelectionState {
  step: number
  parentName: string
  phone: string
  portraitPage: string | null      // photo_id
  coverOption: CoverOption | null
  portraitCover: string | null     // photo_id если 'other'
  studentText: string
  groupPhotos: string[]            // массив photo_id, макс 2
}

export interface AdminStats {
  total: number
  submitted: number
  inProgress: number
  notStarted: number
  portraits_done: number
  groups_done: number
  teachers_total: number
  teachers_done: number
  surcharge_total: number
  surcharge_count: number
}
