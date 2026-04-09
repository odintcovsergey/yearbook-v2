export type CoverMode = 'none' | 'same' | 'optional' | 'required'
export type PhotoType = 'portrait' | 'group' | 'teacher'
export type SelectionType = 'portrait_page' | 'portrait_cover' | 'group'
export type CoverOption = 'none' | 'same' | 'other'

export interface Album {
  id: string
  title: string
  classes: string[]
  cover_mode: CoverMode
  cover_price: number
  deadline: string | null
}

export interface Child {
  id: string
  album_id: string
  full_name: string
  class: string
  access_token: string
  submitted_at: string | null
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
