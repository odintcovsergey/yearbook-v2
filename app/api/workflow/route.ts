import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-error'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'
import { ycUpload, ycDelete, stripYcPrefix, getPhotoSignedUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['owner', 'manager', 'viewer', 'superadmin'])
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const albumId = searchParams.get('album_id')

  // ── Статус альбома + оригиналы + delivery файлы ────────────────────────────
  if (action === 'album_workflow' && albumId) {
    const albumQ = supabaseAdmin
      .from('albums')
      .select('id, title, workflow_status, workflow_submitted_at, workflow_taken_at, workflow_delivered_at, workflow_notes, workflow_assigned_to')
      .eq('id', albumId)

    if (auth.role !== 'superadmin') albumQ.eq('tenant_id', auth.tenantId)
    const { data: album, error } = await albumQ.single()
    if (error || !album) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const [originalsRes, deliveryRes] = await Promise.all([
      supabaseAdmin.from('original_photos').select('id, filename, storage_path, file_size, created_at').eq('album_id', albumId),
      supabaseAdmin.from('delivery_files').select('id, filename, storage_path, file_size, label, expires_at, downloaded_at, created_at').eq('album_id', albumId),
    ])

    // Бакет приватный — отдаём signed URL (TTL 24ч) для скачивания
    // оригиналов (ретушь/цветокор) и delivery-файлов в кабинете.
    const originals = await Promise.all((originalsRes.data ?? []).map(async (o: any) => ({
      ...o,
      url: await getPhotoSignedUrl(o.storage_path),
    })))
    const delivery = await Promise.all((deliveryRes.data ?? []).map(async (d: any) => ({
      ...d,
      url: await getPhotoSignedUrl(d.storage_path),
    })))

    return NextResponse.json({
      workflow: album,
      originals,
      delivery,
    })
  }

  // ── Очередь для OkeyBook (суперадмин и okeybook_manager) ──────────────────
  if (action === 'queue') {
    if (auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const statuses = searchParams.get('status')?.split(',') ?? ['submitted', 'in_production']

    const { data, error } = await supabaseAdmin
      .from('albums')
      .select(`
        id, title, city, year, workflow_status,
        workflow_submitted_at, workflow_taken_at, workflow_assigned_to,
        workflow_notes,
        tenants(name),
        children(id)
      `)
      .in('workflow_status', statuses)
      .order('workflow_submitted_at', { ascending: true })

    if (error) return serverError(error, 'workflow')

    // Считаем учеников
    const albums = (data ?? []).map((a: any) => ({
      ...a,
      student_count: a.children?.length ?? 0,
      children: undefined,
    }))

    return NextResponse.json({ albums })
  }

  // ── Тарифы ────────────────────────────────────────────────────────────────
  if (action === 'pricing') {
    const tenantId = auth.role === 'superadmin'
      ? searchParams.get('tenant_id')
      : auth.tenantId

    const { data } = await supabaseAdmin
      .from('okeybook_pricing')
      .select('*')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .order('template_title')

    // Если есть tenant-specific — перекрывает глобальный
    const byTemplate: Record<string, any> = {}
    for (const p of data ?? []) {
      if (!byTemplate[p.template_title] || p.tenant_id !== null) {
        byTemplate[p.template_title] = p
      }
    }

    return NextResponse.json({ pricing: Object.values(byTemplate) })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''

  // ── Мультипарт: загрузка оригиналов или delivery файлов ───────────────────
  if (contentType.includes('multipart/form-data')) {
    const auth = await requireAuth(req, ['owner', 'manager', 'superadmin'])
    if (isAuthError(auth)) return auth

    const formData = await req.formData()
    const albumId = formData.get('album_id') as string
    const uploadType = formData.get('upload_type') as string // 'original' | 'delivery'
    const file = formData.get('file') as File | null
    const label = formData.get('label') as string | null

    if (!albumId || !file || !uploadType) {
      return NextResponse.json({ error: 'album_id, file, upload_type required' }, { status: 400 })
    }

    // Проверяем доступ к альбому
    const { data: album } = await supabaseAdmin
      .from('albums')
      .select('id, tenant_id, workflow_status, title')
      .eq('id', albumId)
      .single()

    if (!album) return NextResponse.json({ error: 'album not found' }, { status: 404 })
    if (auth.role !== 'superadmin' && album.tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const MAX_SIZE = 50 * 1024 * 1024 // 50 МБ
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Файл слишком большой (максимум 50 МБ)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const folder = uploadType === 'delivery' ? 'delivery' : 'originals'
    const storagePath = `${albumId}/${folder}/${Date.now()}_${file.name}`
    const ycPath = `yc:${storagePath}`

    await ycUpload(storagePath, buffer, file.type || 'application/octet-stream')

    const table = uploadType === 'delivery' ? 'delivery_files' : 'original_photos'
    const insertData: Record<string, unknown> = {
      album_id: albumId,
      tenant_id: album.tenant_id,
      storage_path: ycPath,
      filename: file.name,
      file_size: file.size,
      uploaded_by: auth.userId,
    }

    if (uploadType === 'delivery') {
      // expires_at: полгода с момента загрузки
      const expiresAt = new Date()
      expiresAt.setMonth(expiresAt.getMonth() + 6)
      insertData.expires_at = expiresAt.toISOString()
      insertData.label = label || 'Готовый файл'
    }

    const { data: record, error: dbErr } = await supabaseAdmin
      .from(table)
      .insert(insertData)
      .select()
      .single()

    if (dbErr) {
      await ycDelete(storagePath)
      return serverError(dbErr, 'workflow')
    }

    await logAction(auth, `workflow.upload_${uploadType}`, 'album', albumId, { filename: file.name })

    // Если delivery файл — переводим статус в delivered
    if (uploadType === 'delivery' && album.workflow_status === 'in_production') {
      await supabaseAdmin.from('albums').update({
        workflow_status: 'delivered',
        workflow_delivered_at: new Date().toISOString(),
      }).eq('id', albumId)
    }

    return NextResponse.json({ record })
  }

  // ── JSON: смена статуса, назначение, заметки ───────────────────────────────
  const auth = await requireAuth(req, ['owner', 'manager', 'superadmin'])
  if (isAuthError(auth)) return auth
  const body = await req.json()
  const { action, album_id } = body

  if (!album_id) return NextResponse.json({ error: 'album_id required' }, { status: 400 })

  // Загружаем альбом
  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('id, tenant_id, workflow_status, title')
    .eq('id', album_id)
    .single()

  if (!album) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const isSuperOrOkeybook = auth.role === 'superadmin'
  const isOwner = auth.role !== 'superadmin' && album.tenant_id === auth.tenantId

  if (!isSuperOrOkeybook && !isOwner) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // ── submit — партнёр передаёт в OkeyBook ───────────────────────────────────
  if (action === 'submit') {
    if (!isOwner) return NextResponse.json({ error: 'only partner can submit' }, { status: 403 })
    if (!['active', 'ready'].includes(album.workflow_status)) {
      return NextResponse.json({ error: 'Нельзя передать в текущем статусе' }, { status: 400 })
    }

    const { data } = await supabaseAdmin.from('albums')
      .update({ workflow_status: 'submitted', workflow_submitted_at: new Date().toISOString() })
      .eq('id', album_id).select().single()

    await logAction(auth, 'workflow.submit', 'album', album_id, { title: album.title })
    return NextResponse.json({ album: data })
  }

  // ── take — OkeyBook берёт в работу ────────────────────────────────────────
  if (action === 'take') {
    if (!isSuperOrOkeybook) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const { data } = await supabaseAdmin.from('albums')
      .update({
        workflow_status: 'in_production',
        workflow_taken_at: new Date().toISOString(),
        workflow_assigned_to: auth.userId,
        workflow_notes: body.notes ?? null,
      })
      .eq('id', album_id).select().single()

    await logAction(auth, 'workflow.take', 'album', album_id, {})
    return NextResponse.json({ album: data })
  }

  // ── mark_ready — досрочно завершить отбор ─────────────────────────────────
  if (action === 'mark_ready') {
    if (!isOwner) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const { data } = await supabaseAdmin.from('albums')
      .update({ workflow_status: 'ready' })
      .eq('id', album_id).select().single()

    await logAction(auth, 'workflow.mark_ready', 'album', album_id, {})
    return NextResponse.json({ album: data })
  }

  // ── unsubmit — откат workflow назад ───────────────────────────────────────
  //
  // Использование: партнёр случайно передал альбом или нашёл ошибку
  // после передачи. OkeyBook откатывает альбом который ошибочно взял
  // в работу.
  //
  // Переходы:
  //   submitted (передан, OkeyBook ещё не взял) → ready
  //     — может партнёр (owner альбома) ИЛИ OkeyBook
  //   in_production (OkeyBook верстает) → submitted
  //     — только OkeyBook/superadmin (партнёр звонит)
  //   delivered → in_production — НЕ через эту action, только SQL
  //     (нужны редкие исключения, и риск что файлы уже в типографии)
  //
  // Очищаем соответствующие timestamp'ы чтобы не было «мусорных»
  // меток при следующем submit.
  if (action === 'unsubmit') {
    if (album.workflow_status === 'submitted') {
      // submitted → ready. Доступно партнёру и OkeyBook.
      const { data } = await supabaseAdmin.from('albums')
        .update({
          workflow_status: 'ready',
          workflow_submitted_at: null,
        })
        .eq('id', album_id).select().single()

      await logAction(auth, 'workflow.unsubmit', 'album', album_id, {
        from: 'submitted',
        to: 'ready',
      })
      return NextResponse.json({ album: data })
    }

    if (album.workflow_status === 'in_production') {
      // in_production → submitted. Только OkeyBook/superadmin —
      // партнёр не должен сам прерывать вёрстку, должен звонить.
      if (!isSuperOrOkeybook) {
        return NextResponse.json({
          error: 'Альбом уже взят в работу. Свяжитесь с OkeyBook для отмены.',
        }, { status: 403 })
      }
      const { data } = await supabaseAdmin.from('albums')
        .update({
          workflow_status: 'submitted',
          workflow_taken_at: null,
          workflow_assigned_to: null,
        })
        .eq('id', album_id).select().single()

      await logAction(auth, 'workflow.unsubmit', 'album', album_id, {
        from: 'in_production',
        to: 'submitted',
      })
      return NextResponse.json({ album: data })
    }

    return NextResponse.json({
      error: `Нельзя откатить статус "${album.workflow_status}". Доступно только для submitted и in_production.`,
    }, { status: 400 })
  }

  // ── update_notes — заметки (только superadmin) ────────────────────────────
  if (action === 'update_notes') {
    if (!isSuperOrOkeybook) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const { data } = await supabaseAdmin.from('albums')
      .update({ workflow_notes: body.notes })
      .eq('id', album_id).select().single()

    return NextResponse.json({ album: data })
  }

  // ── delete_original — удалить оригинал ───────────────────────────────────
  if (action === 'delete_original') {
    if (!isSuperOrOkeybook && !isOwner) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    // B2: файл должен принадлежать этому альбому (album уже проверен на доступ).
    const { data: photo } = await supabaseAdmin
      .from('original_photos').select('storage_path')
      .eq('id', body.file_id).eq('album_id', album_id).single()
    if (photo) {
      await ycDelete(stripYcPrefix(photo.storage_path))
      await supabaseAdmin.from('original_photos').delete().eq('id', body.file_id).eq('album_id', album_id)
    }
    return NextResponse.json({ ok: true })
  }

  // ── register_delivery — регистрация уже загруженного delivery файла ─────────
  if (action === 'register_delivery') {
    const { storage_path, filename, file_size, label } = body
    if (!storage_path || !filename) {
      return NextResponse.json({ error: 'storage_path and filename required' }, { status: 400 })
    }
    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + 6)

    const { data: record, error: dbErr } = await supabaseAdmin
      .from('delivery_files')
      .insert({
        album_id: album_id,
        tenant_id: album.tenant_id,
        storage_path,
        filename,
        file_size: file_size ?? null,
        label: label || 'Готовый файл',
        expires_at: expiresAt.toISOString(),
        uploaded_by: auth.userId,
      })
      .select().single()

    if (dbErr) return serverError(dbErr, 'workflow')

    // Переводим в delivered если был in_production
    if (album.workflow_status === 'in_production') {
      await supabaseAdmin.from('albums').update({
        workflow_status: 'delivered',
        workflow_delivered_at: new Date().toISOString(),
      }).eq('id', album_id)
    }

    await logAction(auth, 'workflow.register_delivery', 'album', album_id, { filename })
    return NextResponse.json({ record })
  }

  // ── mark_downloaded — партнёр скачал delivery файл ───────────────────────
  if (action === 'mark_downloaded') {
    // B2: файл должен принадлежать этому альбому.
    await supabaseAdmin.from('delivery_files')
      .update({ downloaded_at: new Date().toISOString() })
      .eq('id', body.file_id)
      .eq('album_id', album_id)
      .is('downloaded_at', null)
    return NextResponse.json({ ok: true })
  }

  // ── register_retouched — фаза К.3 — регистрация обработанных оригиналов ─
  //
  // Клиент сначала залил каждый файл напрямую в YC через /api/upload-url
  // (upload_type='originals' → путь <album_id>/originals/<ts>_<filename>).
  // Затем шлёт сюда массив {filename, storage_path}.
  //
  // Сервер для каждого filename ищет photo (album_id + filename), и:
  //   - если match: обновляет photos.original_path, удаляет старый файл из YC
  //   - если no match: оставляет файл в YC (для К.5 ручной привязки),
  //     возвращает в unmatched
  //
  // Body: { album_id, files: [{ filename, storage_path }] }
  // Response: { matched, unmatched, replaced }
  if (action === 'register_retouched') {
    const files: { filename: string; storage_path: string }[] = body.files ?? []
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: 'files array required' }, { status: 400 })
    }

    // Безопасность: все storage_path должны быть в пределах /originals/
    // этого альбома. Иначе клиент мог бы передать произвольный путь и
    // привязать его как оригинал любому фото.
    const expectedPrefix = `yc:${album_id}/originals/`
    for (const f of files) {
      if (!f.filename || !f.storage_path || !f.storage_path.startsWith(expectedPrefix)) {
        return NextResponse.json(
          {
            error: 'invalid file entry',
            hint: `storage_path должен начинаться с ${expectedPrefix}`,
            file: f,
          },
          { status: 400 }
        )
      }
    }

    // Достаём photos одним запросом — все filename'ы из input
    const filenames = Array.from(new Set(files.map((f) => f.filename)))
    const { data: photos } = await supabaseAdmin
      .from('photos')
      .select('id, filename, type, original_path')
      .eq('album_id', album_id)
      .in('filename', filenames)

    // Маппинг filename → photos (может быть несколько при дублях, берём
    // первый по порядку из БД)
    const photoByFilename = new Map<string, any>()
    for (const p of (photos ?? []) as any[]) {
      if (!photoByFilename.has(p.filename)) photoByFilename.set(p.filename, p)
    }

    const replaced: Array<{
      photo_id: string
      filename: string
      type: string
      old_original_path: string | null
      new_original_path: string
    }> = []
    const unmatched: Array<{ filename: string; storage_path: string }> = []
    const oldPathsToDelete: string[] = []

    for (const f of files) {
      const photo = photoByFilename.get(f.filename)
      if (!photo) {
        unmatched.push({ filename: f.filename, storage_path: f.storage_path })
        continue
      }

      // Обновляем БД
      const { error: updErr } = await supabaseAdmin
        .from('photos')
        .update({ original_path: f.storage_path })
        .eq('id', photo.id)

      if (updErr) {
        // Не падаем целиком — считаем как unmatched для отчёта,
        // файл останется в YC и его можно будет привязать вручную (К.5).
        unmatched.push({ filename: f.filename, storage_path: f.storage_path })
        continue
      }

      replaced.push({
        photo_id: photo.id,
        filename: photo.filename,
        type: photo.type,
        old_original_path: photo.original_path ?? null,
        new_original_path: f.storage_path,
      })

      // Готовим к удалению старый файл — но не сейчас, после всех updates,
      // чтобы не удалить случайно если 2 photos в одном альбоме имели один
      // и тот же original_path (теоретически невозможно, но защищаемся).
      if (
        photo.original_path &&
        photo.original_path !== f.storage_path &&
        photo.original_path.startsWith('yc:')
      ) {
        oldPathsToDelete.push(photo.original_path)
      }
    }

    // Удаляем старые файлы параллельно. Игнорируем ошибки — если файл
    // уже отсутствует в YC, ycDelete вернёт 204/404, не критично.
    if (oldPathsToDelete.length > 0) {
      await Promise.all(
        oldPathsToDelete.map((p) => ycDelete(stripYcPrefix(p)).catch(() => null))
      )
    }

    await logAction(auth, 'workflow.register_retouched', 'album', album_id, {
      replaced: replaced.length,
      unmatched: unmatched.length,
      old_files_deleted: oldPathsToDelete.length,
    })

    return NextResponse.json({
      matched: replaced.length,
      unmatched_count: unmatched.length,
      unmatched,
      replaced,
    })
  }

  // ── rebind_retouched — фаза К.5 — ручная привязка unmatched файла ──────
  //
  // Используется когда автоматический матчинг не нашёл photo для файла
  // (другое имя после ретуши, типос и т.п.). Партнёр в UI выбирает
  // photo_id вручную, файл уже лежит в YC.
  //
  // Body: { album_id, photo_id, storage_path }
  if (action === 'rebind_retouched') {
    const { photo_id, storage_path } = body
    if (!photo_id || !storage_path) {
      return NextResponse.json({ error: 'photo_id and storage_path required' }, { status: 400 })
    }
    const expectedPrefix = `yc:${album_id}/originals/`
    if (typeof storage_path !== 'string' || !storage_path.startsWith(expectedPrefix)) {
      return NextResponse.json(
        { error: 'invalid storage_path', hint: `должен начинаться с ${expectedPrefix}` },
        { status: 400 }
      )
    }

    const { data: photo } = await supabaseAdmin
      .from('photos')
      .select('id, album_id, original_path')
      .eq('id', photo_id)
      .single()

    if (!photo || photo.album_id !== album_id) {
      return NextResponse.json({ error: 'photo not found in this album' }, { status: 404 })
    }

    const oldPath = photo.original_path
    const { error: updErr } = await supabaseAdmin
      .from('photos')
      .update({ original_path: storage_path })
      .eq('id', photo_id)
    if (updErr) return serverError(updErr, 'workflow')

    if (oldPath && oldPath !== storage_path && oldPath.startsWith('yc:')) {
      await ycDelete(stripYcPrefix(oldPath)).catch(() => null)
    }

    await logAction(auth, 'workflow.rebind_retouched', 'album', album_id, {
      photo_id,
      old_path: oldPath,
      new_path: storage_path,
    })

    return NextResponse.json({ ok: true, photo_id, new_original_path: storage_path })
  }

  // ── discard_retouched — фаза К.5 — удалить unmatched файл из YC ────────
  //
  // Партнёр решил что этот файл не нужен (например ZIP содержал лишние).
  // Body: { album_id, storage_path }
  if (action === 'discard_retouched') {
    const { storage_path } = body
    const expectedPrefix = `yc:${album_id}/originals/`
    if (typeof storage_path !== 'string' || !storage_path.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: 'invalid storage_path' }, { status: 400 })
    }
    await ycDelete(stripYcPrefix(storage_path)).catch(() => null)
    await logAction(auth, 'workflow.discard_retouched', 'album', album_id, { storage_path })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
