import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'
import { ycUpload, ycDelete, stripYcPrefix } from '@/lib/storage'

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

    return NextResponse.json({
      workflow: album,
      originals: originalsRes.data ?? [],
      delivery: deliveryRes.data ?? [],
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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
      return NextResponse.json({ error: dbErr.message }, { status: 500 })
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
    const { data: photo } = await supabaseAdmin
      .from('original_photos').select('storage_path').eq('id', body.file_id).single()
    if (photo) {
      await ycDelete(stripYcPrefix(photo.storage_path))
      await supabaseAdmin.from('original_photos').delete().eq('id', body.file_id)
    }
    return NextResponse.json({ ok: true })
  }

  // ── mark_downloaded — партнёр скачал delivery файл ───────────────────────
  if (action === 'mark_downloaded') {
    await supabaseAdmin.from('delivery_files')
      .update({ downloaded_at: new Date().toISOString() })
      .eq('id', body.file_id)
      .is('downloaded_at', null)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
