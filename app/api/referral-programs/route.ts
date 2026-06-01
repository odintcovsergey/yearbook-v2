import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ============================================================
// Управляемые реферальные программы — CRUD + загрузка 2 картинок.
// (ТЗ docs/tz-referral-programs.md.)
//
// Доступ:
//   superadmin       — видит и редактирует ВСЕ программы; может делать
//                       глобальными (set_global).
//   owner / manager  — видят СВОИ (tenant_id = свой tenant) + глобальные
//                       (read-only). Создают/редактируют только свои,
//                       глобальными делать НЕ могут.
//
// Глобальность хранится в двух полях (tenant_id + is_global) синхронно.
// Картинки: bucket referral-images, путь <program_id>/<side>/<uuid>.<ext>,
// двухшаговая загрузка sign/commit (файл мимо сервера).
// ============================================================

const BUCKET = 'referral-images'
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png'])
const SIDES = new Set(['referrer', 'invitee'])

const PROGRAM_FIELDS =
  'id, tenant_id, is_global, name, is_active, ' +
  'referrer_reward_text, referrer_image_url, ' +
  'invitee_headline, invitee_reward_text, invitee_description, invitee_image_url, ' +
  'created_at'

type ProgramRow = {
  id: string
  tenant_id: string | null
  is_global: boolean
  name: string
  is_active: boolean
  referrer_reward_text: string | null
  referrer_image_url: string | null
  invitee_headline: string | null
  invitee_reward_text: string | null
  invitee_description: string | null
  invitee_image_url: string | null
  created_at: string
}

function publicUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

// Внутренний tenant Сергея (slug 'okeybook') — куда привязываем
// НЕглобальные программы, создаваемые суперадмином.
async function okeybookTenantId(): Promise<string | null> {
  const envId = process.env.DEFAULT_TENANT_ID
  if (envId && /^[0-9a-f-]{36}$/i.test(envId)) return envId
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('slug', 'okeybook')
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

// Может ли пользователь редактировать конкретную программу.
// superadmin — любую; партнёр — только свою (по tenant_id).
function canManage(auth: AuthContext, program: { tenant_id: string | null }): boolean {
  if (auth.role === 'superadmin') return true
  return program.tenant_id !== null && program.tenant_id === auth.tenantId
}

// Загрузить программу и проверить права на редактирование. Возвращает
// строку или NextResponse с ошибкой.
async function loadManageable(
  auth: AuthContext,
  id: string,
): Promise<ProgramRow | NextResponse> {
  const { data } = await supabaseAdmin
    .from('referral_programs')
    .select('id, tenant_id, name')
    .eq('id', id)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: 'Программа не найдена' }, { status: 404 })
  if (!canManage(auth, data as { tenant_id: string | null })) {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
  }
  return data as unknown as ProgramRow
}

function pickTextFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const keys = [
    'name',
    'referrer_reward_text',
    'invitee_reward_text',
    'invitee_description',
  ]
  for (const k of keys) {
    if (k in body) {
      const v = body[k]
      out[k] = v === null ? null : String(v).trim()
    }
  }
  return out
}

// ============================================================
// GET — список программ (с учётом роли).
// ============================================================
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

  let query = supabaseAdmin
    .from('referral_programs')
    .select(PROGRAM_FIELDS)
    .order('created_at', { ascending: false })

  if (auth.role !== 'superadmin') {
    query = query.or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // album_count для предупреждения при удалении. Партнёру считаем только
  // по его альбомам (чужие tenant'ы не светим).
  let albumQuery = supabaseAdmin
    .from('albums')
    .select('referral_program_id')
    .not('referral_program_id', 'is', null)
  if (auth.role !== 'superadmin') {
    albumQuery = albumQuery.eq('tenant_id', auth.tenantId)
  }
  const { data: albumRefs } = await albumQuery

  const albumCount: Record<string, number> = {}
  for (const a of albumRefs ?? []) {
    const pid = (a as { referral_program_id: string }).referral_program_id
    albumCount[pid] = (albumCount[pid] ?? 0) + 1
  }

  const rows = (data ?? []) as unknown as ProgramRow[]
  const programs = rows.map((p) => ({
    ...p,
    album_count: albumCount[p.id] ?? 0,
    editable: canManage(auth, p),
  }))

  return NextResponse.json({ ok: true, programs, canSetGlobal: auth.role === 'superadmin' })
}

// ============================================================
// POST — мутации.
// ============================================================
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  const action = String(body.action ?? '')

  // ── Создать ──────────────────────────────────────────────────────────────
  if (action === 'create_program') {
    const fields = pickTextFields(body)
    const name = String(fields.name ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'Укажите название программы' }, { status: 400 })
    }

    // Глобальной может сделать только суперадмин. Партнёрская программа
    // всегда привязана к его tenant.
    let isGlobal = false
    let tenantId: string | null
    if (auth.role === 'superadmin') {
      isGlobal = body.is_global === true
      tenantId = isGlobal ? null : await okeybookTenantId()
      if (!isGlobal && !tenantId) {
        return NextResponse.json({ error: 'Не найден внутренний tenant okeybook' }, { status: 500 })
      }
    } else {
      tenantId = auth.tenantId
    }

    const { data, error } = await supabaseAdmin
      .from('referral_programs')
      .insert({
        ...fields,
        is_global: isGlobal,
        tenant_id: tenantId,
        is_active: body.is_active === false ? false : true,
      })
      .select(PROGRAM_FIELDS)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Не удалось создать' }, { status: 500 })
    }

    const row = data as unknown as ProgramRow
    await logAction(auth, 'referral_program.create', 'referral_program', row.id, { name })
    return NextResponse.json({ ok: true, program: { ...row, album_count: 0, editable: true } })
  }

  // ── Обновить текст ─────────────────────────────────────────────────────────
  if (action === 'update_program') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    const guard = await loadManageable(auth, id)
    if (guard instanceof NextResponse) return guard

    const fields = pickTextFields(body)
    if ('name' in fields && !String(fields.name ?? '').trim()) {
      return NextResponse.json({ error: 'Название не может быть пустым' }, { status: 400 })
    }
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('referral_programs')
      .update(fields)
      .eq('id', id)
      .select(PROGRAM_FIELDS)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Программа не найдена' }, { status: 404 })
    }
    await logAction(auth, 'referral_program.update', 'referral_program', id, { fields: Object.keys(fields) })
    return NextResponse.json({ ok: true, program: data })
  }

  // ── Вкл/выкл ────────────────────────────────────────────────────────────────
  if (action === 'toggle_active') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    const guard = await loadManageable(auth, id)
    if (guard instanceof NextResponse) return guard

    const { error } = await supabaseAdmin
      .from('referral_programs')
      .update({ is_active: body.is_active === true })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── Глобальность — только суперадмин ─────────────────────────────────────────
  if (action === 'set_global') {
    if (auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Глобальной может сделать только OkeyBook' }, { status: 403 })
    }
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    const makeGlobal = body.make_global === true
    const tenantId = makeGlobal ? null : await okeybookTenantId()
    if (!makeGlobal && !tenantId) {
      return NextResponse.json({ error: 'Не найден внутренний tenant okeybook' }, { status: 500 })
    }
    const { error } = await supabaseAdmin
      .from('referral_programs')
      .update({ is_global: makeGlobal, tenant_id: tenantId })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAction(auth, 'referral_program.set_global', 'referral_program', id, { makeGlobal })
    return NextResponse.json({ ok: true })
  }

  // ── Дублировать ──────────────────────────────────────────────────────────────
  if (action === 'duplicate_program') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

    // Дублировать можно свою ИЛИ глобальную (партнёр берёт готовую связку себе).
    const { data: srcData } = await supabaseAdmin
      .from('referral_programs')
      .select(PROGRAM_FIELDS)
      .eq('id', id)
      .single()
    if (!srcData) return NextResponse.json({ error: 'Программа не найдена' }, { status: 404 })
    const src = srcData as unknown as ProgramRow
    const isGlobalSrc = src.tenant_id === null
    const canCopy = auth.role === 'superadmin' || isGlobalSrc || src.tenant_id === auth.tenantId
    if (!canCopy) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })

    // Куда кладём копию: суперадмин сохраняет принадлежность источника;
    // партнёр всегда забирает в свой tenant (НЕглобальной).
    const targetTenant = auth.role === 'superadmin' ? src.tenant_id : auth.tenantId
    const targetGlobal = auth.role === 'superadmin' ? src.is_global : false

    const { data, error } = await supabaseAdmin
      .from('referral_programs')
      .insert({
        tenant_id: targetTenant,
        is_global: targetGlobal,
        name: `${src.name} (копия)`,
        is_active: false,
        referrer_reward_text: src.referrer_reward_text,
        invitee_reward_text: src.invitee_reward_text,
        invitee_description: src.invitee_description,
      })
      .select(PROGRAM_FIELDS)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Не удалось дублировать' }, { status: 500 })
    }
    const row = data as unknown as ProgramRow
    await logAction(auth, 'referral_program.duplicate', 'referral_program', row.id, { from: id })
    return NextResponse.json({ ok: true, program: { ...row, album_count: 0, editable: true } })
  }

  // ── Картинка: подписанная ссылка ─────────────────────────────────────────────
  if (action === 'sign') {
    const programId = String(body.program_id ?? '')
    const side = String(body.side ?? '')
    const ext = String(body.ext ?? '').toLowerCase()
    if (!programId) return NextResponse.json({ error: 'program_id обязателен' }, { status: 400 })
    if (!SIDES.has(side)) return NextResponse.json({ error: 'side: referrer|invitee' }, { status: 400 })
    if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: 'Допустимы только JPG и PNG' }, { status: 400 })
    const guard = await loadManageable(auth, programId)
    if (guard instanceof NextResponse) return guard

    const path = `${programId}/${side}/${crypto.randomUUID()}.${ext}`
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Не удалось подписать загрузку' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, path, token: data.token })
  }

  // ── Картинка: зафиксировать URL ──────────────────────────────────────────────
  if (action === 'commit') {
    const programId = String(body.program_id ?? '')
    const side = String(body.side ?? '')
    const path = String(body.path ?? '')
    if (!programId) return NextResponse.json({ error: 'program_id обязателен' }, { status: 400 })
    if (!SIDES.has(side)) return NextResponse.json({ error: 'side: referrer|invitee' }, { status: 400 })
    if (!path.startsWith(`${programId}/${side}/`)) {
      return NextResponse.json({ error: 'Недопустимый путь файла' }, { status: 400 })
    }
    const guard = await loadManageable(auth, programId)
    if (guard instanceof NextResponse) return guard

    const column = side === 'referrer' ? 'referrer_image_url' : 'invitee_image_url'
    const { data, error } = await supabaseAdmin
      .from('referral_programs')
      .update({ [column]: publicUrl(path) })
      .eq('id', programId)
      .select(PROGRAM_FIELDS)
      .single()
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Программа не найдена' }, { status: 404 })
    }
    await logAction(auth, 'referral_program.upload_image', 'referral_program', programId, { side })
    return NextResponse.json({ ok: true, program: data })
  }

  // ── Удалить картинку ─────────────────────────────────────────────────────────
  if (action === 'remove_image') {
    const programId = String(body.program_id ?? '')
    const side = String(body.side ?? '')
    if (!programId) return NextResponse.json({ error: 'program_id обязателен' }, { status: 400 })
    if (!SIDES.has(side)) return NextResponse.json({ error: 'side: referrer|invitee' }, { status: 400 })
    const guard = await loadManageable(auth, programId)
    if (guard instanceof NextResponse) return guard

    const column = side === 'referrer' ? 'referrer_image_url' : 'invitee_image_url'
    const { data, error } = await supabaseAdmin
      .from('referral_programs')
      .update({ [column]: null })
      .eq('id', programId)
      .select(PROGRAM_FIELDS)
      .single()
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Программа не найдена' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, program: data })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

// ============================================================
// DELETE — удалить программу (?id=). Своя/любая (по роли).
// ============================================================
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
  const guard = await loadManageable(auth, id)
  if (guard instanceof NextResponse) return guard

  for (const side of ['referrer', 'invitee']) {
    const { data: files } = await supabaseAdmin.storage.from(BUCKET).list(`${id}/${side}`)
    if (files && files.length > 0) {
      await supabaseAdmin.storage.from(BUCKET).remove(files.map((f) => `${id}/${side}/${f.name}`))
    }
  }

  const { error } = await supabaseAdmin.from('referral_programs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await logAction(auth, 'referral_program.delete', 'referral_program', id, { name: guard.name })
  return NextResponse.json({ ok: true })
}
