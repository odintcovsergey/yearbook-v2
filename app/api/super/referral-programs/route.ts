import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ============================================================
// Управляемые реферальные программы — CRUD + загрузка 2 картинок.
// (ТЗ docs/tz-referral-programs.md, Этап 1.)
//
// Конструктор живёт в супер-админке. Программа описывает награды ОБЕИХ
// сторон реферала: реферер (кто рекомендует) и реферал (кто пришёл).
//
// Глобальность — как у template_sets: храним tenant_id И is_global
// синхронно. is_global=true → tenant_id=NULL (видят все партнёры).
// is_global=false → tenant_id=okeybook (внутренняя программа Сергея).
//
// Картинки: bucket referral-images, путь <program_id>/<side>/<uuid>.<ext>.
// Двухшаговая загрузка sign/commit (файл мимо сервера, обход лимита Vercel).
// В колонку пишем готовый публичный URL — родительские страницы используют
// его напрямую без пересборки.
// ============================================================

const BUCKET = 'referral-images'
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png'])
const SIDES = new Set(['referrer', 'invitee'])

const PROGRAM_FIELDS =
  'id, tenant_id, is_global, name, is_active, ' +
  'referrer_reward_text, referrer_image_url, ' +
  'invitee_headline, invitee_reward_text, invitee_description, invitee_image_url, ' +
  'created_at'

// PostgREST не выводит тип строки из переменной PROGRAM_FIELDS — описываем
// форму строки явно и кастуем data к ней (паттерн проекта).
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
// НЕглобальные программы. Зеркалит okeybookTenantId() из /api/tenant.
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

// Текстовые поля программы, общие для create/update.
function pickTextFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const keys = [
    'name',
    'referrer_reward_text',
    'invitee_headline',
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
// GET — список всех программ (superadmin видит всё).
// ============================================================
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const { data, error } = await supabaseAdmin
    .from('referral_programs')
    .select(PROGRAM_FIELDS)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Сколько альбомов привязано к каждой программе (для предупреждения при удалении).
  const { data: albumRefs } = await supabaseAdmin
    .from('albums')
    .select('referral_program_id')
    .not('referral_program_id', 'is', null)

  const albumCount: Record<string, number> = {}
  for (const a of albumRefs ?? []) {
    const pid = (a as { referral_program_id: string }).referral_program_id
    albumCount[pid] = (albumCount[pid] ?? 0) + 1
  }

  const rows = (data ?? []) as unknown as ProgramRow[]
  const programs = rows.map((p) => ({
    ...p,
    album_count: albumCount[p.id] ?? 0,
  }))

  return NextResponse.json({ ok: true, programs })
}

// ============================================================
// POST — мутации (диспетчер по body.action).
// ============================================================
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  const action = String(body.action ?? '')

  // ── Создать программу ───────────────────────────────────────────────────
  if (action === 'create_program') {
    const fields = pickTextFields(body)
    const name = String(fields.name ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'Укажите название программы' }, { status: 400 })
    }

    const makeGlobal = body.is_global === true
    let tenantId: string | null = null
    if (!makeGlobal) {
      tenantId = await okeybookTenantId()
      if (!tenantId) {
        return NextResponse.json(
          { error: 'Не найден внутренний tenant okeybook' },
          { status: 500 },
        )
      }
    }

    const { data, error } = await supabaseAdmin
      .from('referral_programs')
      .insert({
        ...fields,
        is_global: makeGlobal,
        tenant_id: tenantId,
        is_active: body.is_active === false ? false : true,
      })
      .select(PROGRAM_FIELDS)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Не удалось создать программу' },
        { status: 500 },
      )
    }

    const row = data as unknown as ProgramRow
    await logAction(auth, 'referral_program.create', 'referral_program', row.id, { name })
    return NextResponse.json({ ok: true, program: { ...row, album_count: 0 } })
  }

  // ── Обновить текстовые поля ─────────────────────────────────────────────
  if (action === 'update_program') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

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
      return NextResponse.json(
        { error: error?.message ?? 'Программа не найдена' },
        { status: 404 },
      )
    }

    await logAction(auth, 'referral_program.update', 'referral_program', id, {
      fields: Object.keys(fields),
    })
    return NextResponse.json({ ok: true, program: data })
  }

  // ── Вкл/выкл активность ─────────────────────────────────────────────────
  if (action === 'toggle_active') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    const isActive = body.is_active === true

    const { error } = await supabaseAdmin
      .from('referral_programs')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAction(auth, 'referral_program.toggle_active', 'referral_program', id, { isActive })
    return NextResponse.json({ ok: true })
  }

  // ── Переключить глобальность (пишем ОБА поля) ───────────────────────────
  if (action === 'set_global') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    const makeGlobal = body.make_global === true

    let tenantId: string | null = null
    if (!makeGlobal) {
      tenantId = await okeybookTenantId()
      if (!tenantId) {
        return NextResponse.json(
          { error: 'Не найден внутренний tenant okeybook' },
          { status: 500 },
        )
      }
    }

    const { error } = await supabaseAdmin
      .from('referral_programs')
      .update({ is_global: makeGlobal, tenant_id: tenantId })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAction(auth, 'referral_program.set_global', 'referral_program', id, { makeGlobal })
    return NextResponse.json({ ok: true })
  }

  // ── Дублировать ─────────────────────────────────────────────────────────
  if (action === 'duplicate_program') {
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

    const { data: srcData, error: srcErr } = await supabaseAdmin
      .from('referral_programs')
      .select(PROGRAM_FIELDS)
      .eq('id', id)
      .single()

    if (srcErr || !srcData) {
      return NextResponse.json({ error: 'Программа не найдена' }, { status: 404 })
    }
    const src = srcData as unknown as ProgramRow

    // Картинки НЕ копируем (файлы в storage привязаны к старому program_id) —
    // дубль создаётся без картинок, их можно загрузить заново.
    const { data, error } = await supabaseAdmin
      .from('referral_programs')
      .insert({
        tenant_id: src.tenant_id,
        is_global: src.is_global,
        name: `${src.name} (копия)`,
        is_active: false, // копию создаём выключенной — допилить и включить
        referrer_reward_text: src.referrer_reward_text,
        invitee_headline: src.invitee_headline,
        invitee_reward_text: src.invitee_reward_text,
        invitee_description: src.invitee_description,
      })
      .select(PROGRAM_FIELDS)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Не удалось дублировать' },
        { status: 500 },
      )
    }

    const row = data as unknown as ProgramRow
    await logAction(auth, 'referral_program.duplicate', 'referral_program', row.id, { from: id })
    return NextResponse.json({ ok: true, program: { ...row, album_count: 0 } })
  }

  // ── Шаг 1 загрузки картинки: подписанная ссылка ─────────────────────────
  if (action === 'sign') {
    const programId = String(body.program_id ?? '')
    const side = String(body.side ?? '')
    const ext = String(body.ext ?? '').toLowerCase()
    if (!programId) return NextResponse.json({ error: 'program_id обязателен' }, { status: 400 })
    if (!SIDES.has(side)) return NextResponse.json({ error: 'side: referrer|invitee' }, { status: 400 })
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: 'Допустимы только JPG и PNG' }, { status: 400 })
    }

    const path = `${programId}/${side}/${crypto.randomUUID()}.${ext}`
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path)
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Не удалось подписать загрузку' },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, path, token: data.token })
  }

  // ── Шаг 2: зафиксировать URL картинки в программе ───────────────────────
  if (action === 'commit') {
    const programId = String(body.program_id ?? '')
    const side = String(body.side ?? '')
    const path = String(body.path ?? '')
    if (!programId) return NextResponse.json({ error: 'program_id обязателен' }, { status: 400 })
    if (!SIDES.has(side)) return NextResponse.json({ error: 'side: referrer|invitee' }, { status: 400 })
    // Защита: путь должен лежать в каталоге этой программы и стороны.
    if (!path.startsWith(`${programId}/${side}/`)) {
      return NextResponse.json({ error: 'Недопустимый путь файла' }, { status: 400 })
    }

    const column = side === 'referrer' ? 'referrer_image_url' : 'invitee_image_url'
    const { data, error } = await supabaseAdmin
      .from('referral_programs')
      .update({ [column]: publicUrl(path) })
      .eq('id', programId)
      .select(PROGRAM_FIELDS)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Программа не найдена' },
        { status: 404 },
      )
    }

    await logAction(auth, 'referral_program.upload_image', 'referral_program', programId, { side })
    return NextResponse.json({ ok: true, program: data })
  }

  // ── Удалить картинку (без удаления программы) ───────────────────────────
  if (action === 'remove_image') {
    const programId = String(body.program_id ?? '')
    const side = String(body.side ?? '')
    if (!programId) return NextResponse.json({ error: 'program_id обязателен' }, { status: 400 })
    if (!SIDES.has(side)) return NextResponse.json({ error: 'side: referrer|invitee' }, { status: 400 })

    const column = side === 'referrer' ? 'referrer_image_url' : 'invitee_image_url'
    // Файлы в storage оставляем (best-effort чистка только при удалении программы).
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
// DELETE — удалить программу (?id=<uuid>).
// FK ON DELETE SET NULL обнулит albums.referral_program_id и
// referral_leads.program_id автоматически. Картинки чистим best-effort.
// ============================================================
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const { data: program } = await supabaseAdmin
    .from('referral_programs')
    .select('id, name')
    .eq('id', id)
    .single()

  if (!program) return NextResponse.json({ error: 'Программа не найдена' }, { status: 404 })

  // Best-effort удаление картинок программы из storage.
  for (const side of ['referrer', 'invitee']) {
    const { data: files } = await supabaseAdmin.storage.from(BUCKET).list(`${id}/${side}`)
    if (files && files.length > 0) {
      await supabaseAdmin.storage
        .from(BUCKET)
        .remove(files.map((f) => `${id}/${side}/${f.name}`))
    }
  }

  const { error } = await supabaseAdmin.from('referral_programs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAction(auth, 'referral_program.delete', 'referral_program', id, { name: program.name })
  return NextResponse.json({ ok: true })
}
