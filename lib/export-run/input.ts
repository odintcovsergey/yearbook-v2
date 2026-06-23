/**
 * Сборка AlbumExportInput из БД — общая часть PDF- и типографского экспорта.
 *
 * Вынесено из app/api/layout/route.ts (шаги 5a–5e handleExportPdf / 7
 * handleExportTypography) без изменения логики. Источники: smart-fill,
 * оригиналы (photos.original_path + legacy original_photos), urlToFilename,
 * категорийные фоны набора.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { stripYcPrefix } from '@/lib/storage'
import { buildAlbumInput } from '@/lib/smart-fill'
import type {
  AlbumExportInput,
  ExportProfile,
  OriginalPhoto,
} from '@/lib/pdf-export'
import type { TemplateSet } from '@/lib/album-builder'
import { ExportRunError } from './core'

/** Поля альбома, нужные сборке входа экспорта. */
export type ExportAlbumRow = {
  id: string
  title: string
  tenant_id: string
}

/** Поля сохранённой вёрстки, нужные сборке входа. */
export type ExportLayoutRow = {
  spreads: Array<Record<string, unknown>>
  has_user_edits: boolean
}

/**
 * Собирает AlbumExportInput. Бросает ExportRunError при сбое smart-fill /
 * загрузки фото (как и раньше отдавал 500).
 */
export async function buildCoreExportInput(args: {
  albumId: string
  album: ExportAlbumRow
  layout: ExportLayoutRow
  templateSet: TemplateSet
  profile: ExportProfile
  effectivePrintType: string
}): Promise<AlbumExportInput> {
  const { albumId, album, layout, templateSet, profile, effectivePrintType } = args

  // smart-fill — вход билдера.
  let smartFill
  try {
    smartFill = await buildAlbumInput(supabaseAdmin, albumId)
  } catch (e) {
    throw new ExportRunError(`smart-fill failed: ${(e as Error).message}`, 'smart_fill_failed', 500)
  }

  // legacy originals (original_photos).
  const { data: legacyOriginalsData, error: legacyErr } = await supabaseAdmin
    .from('original_photos')
    .select('id, filename, storage_path')
    .eq('album_id', albumId)
  if (legacyErr) {
    throw new ExportRunError(`legacy originals load failed: ${legacyErr.message}`, 'originals_failed', 500)
  }
  const legacyOriginals: OriginalPhoto[] = (legacyOriginalsData ?? []).map((row) => ({
    id: String(row.id),
    filename: String(row.filename),
    storage_path: String(row.storage_path),
  }))

  // photos: urlToFilename + inline originals (photos.original_path).
  const { data: photosData, error: photosErr } = await supabaseAdmin
    .from('photos')
    .select('id, filename, storage_path, original_path')
    .eq('album_id', albumId)
  if (photosErr) {
    throw new ExportRunError(`photos load failed: ${photosErr.message}`, 'photos_failed', 500)
  }
  const urlToFilename: Record<string, string> = {}
  const inlineOriginals: OriginalPhoto[] = []
  for (const p of photosData ?? []) {
    const row = p as Record<string, unknown>
    const storagePath = String(row.storage_path)
    const filename = String(row.filename)
    urlToFilename[stripYcPrefix(storagePath)] = filename
    const originalPath = row.original_path
    if (typeof originalPath === 'string' && originalPath.length > 0) {
      inlineOriginals.push({
        id: String(row.id),
        filename,
        storage_path: originalPath.startsWith('yc:') ? originalPath.slice(3) : originalPath,
      })
    }
  }
  // Новые (photos.original_path) → legacy: при коллизии filename выигрывает новый.
  const originals: OriginalPhoto[] = [...inlineOriginals, ...legacyOriginals]

  // Пул категорийных фонов набора (ротация фонов в PDF).
  const { data: bgPool } = await supabaseAdmin
    .from('template_set_backgrounds')
    .select('category, url, sort_order')
    .eq('template_set_id', templateSet.id)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })

  return {
    album: {
      id: album.id,
      name: album.title,
      tenant_id: album.tenant_id,
    },
    layout: {
      spreads: layout.spreads as unknown as AlbumExportInput['layout']['spreads'],
      has_user_edits: Boolean(layout.has_user_edits),
    },
    templateSet,
    albumInput: smartFill.input,
    originals,
    urlToFilename,
    profile,
    backgrounds: bgPool ?? [],
    effectivePrintType: effectivePrintType as AlbumExportInput['effectivePrintType'],
  }
}
