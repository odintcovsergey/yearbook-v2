/**
 * executeTypographyExport — ядро типографской выгрузки (action=export_typography):
 * файлы по книгам (000 общая / 00X личные) под формат и приём типографии, в zip.
 *
 * Вынесено из handleExportTypography (app/api/layout/route.ts) без изменения
 * логики рендера. Зовут синхронный путь (малый альбом) и воркер очереди
 * (большой). Лимита 50 разворотов тут НЕТ — большие идут через очередь.
 * История album_exports для типографии не ведётся (как и было).
 */
import { supabaseAdmin } from '@/lib/supabase'
import { ycUpload } from '@/lib/storage'
import { loadTemplateSet, loadTemplateSetById, resolveAlbumEffectivePrintType } from '@/lib/album-builder'
import type { TemplateSet } from '@/lib/album-builder'
import { exportAlbumTypography, type AlbumExportInput, type ExportProfile } from '@/lib/pdf-export'
import { resolveFormat, resolveDesignFamily } from '@/lib/format-adapt'
import type { AcceptMode } from '@/lib/export-typography/plan'
import { buildCoverRenderUnits, type CoverMasterGeometry } from '@/lib/export-typography/covers'
import { loadAlbumCovers } from '@/lib/cover/load-covers'
import { indexCoverEdits, type CoverEditRow } from '@/lib/cover/editor-merge'
import { filterChildrenByPurchase } from '@/lib/smart-fill/filter-by-purchase'
import type { PrinterConfig } from '@/lib/printers/types'
import JSZip from 'jszip'
import { buildCoreExportInput } from './input'
import { slugifyForFilename } from './profile'
import { ExportRunError } from './core'

export type TypographyExportOutput = {
  storagePath: string
  filename: string
  fileSize: number
  fileCount: number
  coverCount: number
  fileFormat: 'pdf' | 'jpeg'
  totalSpreads: number
  hasPersonal: boolean
  acceptMode: AcceptMode
  adaptStatus: string
  adaptWarning?: string
  warnings: { code: string; detail: string }[]
}

export async function executeTypographyExport(params: {
  albumId: string
  storageKey: string
}): Promise<TypographyExportOutput> {
  const { albumId, storageKey } = params

  // Альбом + привязка к типографии.
  const { data: album, error: albumErr } = await supabaseAdmin
    .from('albums')
    .select(
      'id, title, tenant_id, print_type, section_structure_preset_id, config_preset_id, printer_id, format_id, sheet_type_id, include_non_purchasers',
    )
    .eq('id', albumId)
    .single()
  if (albumErr || !album) {
    throw new ExportRunError('album not found', 'album_not_found', 404)
  }

  // Профиль типографии (printers.config) → формат + приём + формат файлов.
  let printerConfig: PrinterConfig | null = null
  if (album.printer_id) {
    const { data: printer } = await supabaseAdmin
      .from('printers')
      .select('config')
      .eq('id', album.printer_id)
      .maybeSingle()
    printerConfig = (printer?.config ?? null) as PrinterConfig | null
  }
  const targetFormat = resolveFormat(printerConfig, album.format_id as string | null)
  const acceptMode: AcceptMode = printerConfig?.accept_mode ?? 'spread'
  const fileFormat: 'pdf' | 'jpeg' = printerConfig?.file_format === 'jpeg' ? 'jpeg' : 'pdf'

  // Вёрстка.
  const { data: layoutRow, error: layoutErr } = await supabaseAdmin
    .from('album_layouts')
    .select('id, spreads, has_user_edits, template_set_id')
    .eq('album_id', albumId)
    .maybeSingle()
  if (layoutErr) {
    throw new ExportRunError(`layout load failed: ${layoutErr.message}`, 'layout_failed', 500)
  }
  if (!layoutRow) {
    throw new ExportRunError(
      'Вёрстка альбома не собрана. Сначала нажмите «Собрать автоматически».',
      'layout_not_built',
      404,
    )
  }
  const spreads = (layoutRow.spreads ?? []) as Array<Record<string, unknown>>
  if (spreads.length === 0) {
    throw new ExportRunError('Вёрстка пустая. Пересоберите её.', 'layout_empty', 400)
  }

  // template_set (тот, на котором собрана вёрстка).
  const layoutTemplateSetId =
    typeof layoutRow.template_set_id === 'string' && layoutRow.template_set_id.length > 0
      ? layoutRow.template_set_id
      : null
  let templateSet: TemplateSet
  try {
    templateSet = layoutTemplateSetId
      ? await loadTemplateSetById(supabaseAdmin, layoutTemplateSetId)
      : await loadTemplateSet(supabaseAdmin)
  } catch (e) {
    throw new ExportRunError(`template_set load failed: ${(e as Error).message}`, 'template_set_failed', 500)
  }

  const effectivePrintType = await resolveAlbumEffectivePrintType(
    supabaseAdmin,
    album as {
      print_type?: string | null
      section_structure_preset_id?: string | null
      config_preset_id?: string | null
    },
  )

  // Синтетический профиль рендера: типография = 300 dpi, с вылетами, оригиналы.
  const typographyProfile: ExportProfile = {
    id: 'typography',
    tenant_id: null,
    slug: 'typography',
    name: 'Типография',
    is_default: false,
    purpose: 'typography',
    format: 'pdf',
    quality: 'high',
    include_bleed: true,
    color_mode: 'rgb',
    dpi: 300,
    jpeg_quality: 92,
    filename_template: '',
    pages_mode: 'all_common',
    target_size_mb: null,
    enabled: true,
    spread_export: false,
  }

  const exportInput: AlbumExportInput = await buildCoreExportInput({
    albumId,
    album: { id: String(album.id), title: String(album.title), tenant_id: String(album.tenant_id) },
    layout: { spreads, has_user_edits: Boolean(layoutRow.has_user_edits) },
    templateSet,
    profile: typographyProfile,
    effectivePrintType,
  })

  // Обложки (000-00 / 00X-00).
  let coverUnits: Awaited<ReturnType<typeof buildCoverRenderUnits>>['units'] = []
  try {
    const assembled = await loadAlbumCovers(supabaseAdmin, albumId)
    if (assembled.covers.length > 0) {
      const coverIds = Array.from(
        new Set(assembled.covers.map((c) => c.cover_id).filter(Boolean)),
      ) as string[]
      const masters = new Map<string, CoverMasterGeometry>()
      if (coverIds.length > 0) {
        const { data: masterRows } = await supabaseAdmin
          .from('covers')
          .select(
            'id, placeholders, back_width_mm, front_width_mm, height_mm, nominal_spine_width_mm, background_url',
          )
          .in('id', coverIds)
        for (const m of (masterRows ?? []) as CoverMasterGeometry[]) masters.set(m.id, m)
      }
      const { data: editRows } = await supabaseAdmin
        .from('cover_edits')
        .select('cover_type, child_id, data')
        .eq('album_id', albumId)
      const { byType, byChild } = indexCoverEdits((editRows ?? []) as CoverEditRow[])

      const { data: kids } = await supabaseAdmin
        .from('children')
        .select('id, is_purchased')
        .eq('album_id', albumId)
        .order('class')
        .order('full_name')
      const includeAll = Boolean(
        (album as { include_non_purchasers?: boolean }).include_non_purchasers,
      )
      const orderedKids = filterChildrenByPurchase(
        (kids ?? []) as Array<{ id: string; is_purchased?: boolean | null }>,
        includeAll,
      )
      const childNumber = new Map<string, number>()
      orderedKids.forEach((c, i) => childNumber.set(c.id, i + 1))

      const built = buildCoverRenderUnits({
        covers: assembled.covers,
        masters,
        editsByType: byType,
        editsByChild: byChild,
        spineWidthMm: assembled.spine_width_mm,
        family: resolveDesignFamily(templateSet),
        targetFormat,
        childNumber,
      })
      coverUnits = built.units
    }
  } catch {
    coverUnits = []
  }

  // Рендер файлов под формат + приём + обложки.
  let result: Awaited<ReturnType<typeof exportAlbumTypography>>
  try {
    result = await exportAlbumTypography(exportInput, {
      acceptMode,
      targetFormat,
      coverUnits,
      fileFormat,
      dpi: 300,
      jpegQuality: 92,
    })
  } catch (e) {
    throw new ExportRunError(`typography render failed: ${(e as Error).message}`, 'render_failed', 500)
  }
  if (result.files.length === 0) {
    throw new ExportRunError(
      'Не получилось ни одного файла (проверьте вёрстку и мастера).',
      'no_files',
      500,
    )
  }

  // ZIP.
  const zip = new JSZip()
  for (const f of result.files) {
    zip.file(`${f.name}.${f.ext}`, Buffer.from(f.bytes))
  }
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  })

  try {
    await ycUpload(storageKey, zipBuffer, 'application/zip')
  } catch (e) {
    throw new ExportRunError(`yc upload failed: ${(e as Error).message}`, 'upload_failed', 500)
  }

  const safeTitle = slugifyForFilename(String(album.title))
  return {
    storagePath: storageKey,
    filename: `${safeTitle || 'album'}_типография.zip`,
    fileSize: zipBuffer.length,
    fileCount: result.files.length,
    coverCount: result.coverCount,
    fileFormat: result.fileFormat,
    totalSpreads: result.totalSpreads,
    hasPersonal: result.hasPersonal,
    acceptMode,
    adaptStatus: result.adaptStatus,
    adaptWarning: result.adaptWarning,
    warnings: result.warnings,
  }
}
