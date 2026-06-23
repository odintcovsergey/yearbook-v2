/**
 * executePdfExport — ядро экспорта цельного PDF (action=export).
 *
 * Вынесено из handleExportPdf (app/api/layout/route.ts) без изменения логики
 * рендера. Зовут синхронный путь (малый альбом → recordHistory:true, ключ
 * по timestamp) и воркер очереди (большой → recordHistory:false, стабильный
 * ключ). Лимита 80 разворотов тут НЕТ — большие идут через очередь.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { ycUpload } from '@/lib/storage'
import { loadTemplateSet, loadTemplateSetById, resolveAlbumEffectivePrintType } from '@/lib/album-builder'
import type { TemplateSet } from '@/lib/album-builder'
import { exportAlbumPdf, type ExportProfile } from '@/lib/pdf-export'
import { buildCoreExportInput } from './input'
import { renderFilename, slugifyForFilename } from './profile'
import { ExportRunError } from './core'

export type PdfExportOutput = {
  storagePath: string
  filename: string
  fileSize: number
  pageCount: number
  warnings: { code: string; detail: string }[]
  exportId: string | null
}

export async function executePdfExport(params: {
  albumId: string
  profile: ExportProfile
  createdBy: string | null
  storageKey: string
  recordHistory: boolean
}): Promise<PdfExportOutput> {
  const { albumId, profile, createdBy, storageKey, recordHistory } = params

  // Поддерживается только all_common + pdf (как в фазе 3).
  if (profile.pages_mode !== 'all_common') {
    throw new ExportRunError(
      'Per-student режим экспорта в разработке (фаза 3.A).',
      'pages_mode_not_implemented',
      501,
    )
  }
  if (profile.format !== 'pdf') {
    throw new ExportRunError(
      `Формат "${profile.format}" в разработке. Поддерживается только PDF.`,
      'format_not_implemented',
      501,
    )
  }

  // Альбом.
  const { data: album, error: albumErr } = await supabaseAdmin
    .from('albums')
    .select('id, title, tenant_id, print_type, section_structure_preset_id, config_preset_id')
    .eq('id', albumId)
    .single()
  if (albumErr || !album) {
    throw new ExportRunError('album not found', 'album_not_found', 404)
  }

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
      'Layout альбома не собран. Сначала нажмите «Собрать автоматически».',
      'layout_not_built',
      404,
    )
  }
  const spreads = (layoutRow.spreads ?? []) as Array<Record<string, unknown>>
  if (spreads.length === 0) {
    throw new ExportRunError('Layout пустой. Пересоберите его.', 'layout_empty', 400)
  }

  // template_set — ровно тот, на котором собрана вёрстка.
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

  const exportInput = await buildCoreExportInput({
    albumId,
    album: { id: String(album.id), title: String(album.title), tenant_id: String(album.tenant_id) },
    layout: { spreads, has_user_edits: Boolean(layoutRow.has_user_edits) },
    templateSet,
    profile,
    effectivePrintType,
  })

  let pdfResult: Awaited<ReturnType<typeof exportAlbumPdf>>
  try {
    pdfResult = await exportAlbumPdf(exportInput)
  } catch (e) {
    throw new ExportRunError(`pdf generation failed: ${(e as Error).message}`, 'render_failed', 500)
  }

  // filename.
  const slugAlbum = slugifyForFilename(String(album.title))
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const datetime = `${date}_${now.toISOString().slice(11, 16).replace(':', '-')}`
  const ext = 'pdf'
  const filename = renderFilename(profile.filename_template, {
    album_name: slugAlbum,
    date,
    datetime,
    ext,
    student_name: '',
  })

  // Upload.
  try {
    await ycUpload(storageKey, Buffer.from(pdfResult.pdfBytes), 'application/pdf')
  } catch (e) {
    throw new ExportRunError(`yc upload failed: ${(e as Error).message}`, 'upload_failed', 500)
  }

  // История (только синхронный путь — у очереди свой реестр export_jobs).
  let exportId: string | null = null
  if (recordHistory) {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 90)
    const { data: insertedRow, error: insertErr } = await supabaseAdmin
      .from('album_exports')
      .insert({
        album_id: albumId,
        tenant_id: album.tenant_id,
        profile_id: profile.id,
        storage_path: storageKey,
        filename,
        file_size: pdfResult.pdfBytes.length,
        page_count: pdfResult.pageCount,
        layout_snapshot: spreads,
        warnings: pdfResult.warnings,
        created_by: createdBy,
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single()
    if (insertErr || !insertedRow) {
      throw new ExportRunError(
        `album_exports insert failed: ${insertErr?.message ?? 'no row'}`,
        'history_insert_failed',
        500,
      )
    }
    exportId = String(insertedRow.id)
  }

  return {
    storagePath: storageKey,
    filename,
    fileSize: pdfResult.pdfBytes.length,
    pageCount: pdfResult.pageCount,
    warnings: pdfResult.warnings,
    exportId,
  }
}
