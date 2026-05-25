import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getPhotoUrl, getThumbUrl } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, hashPassword, verifyPassword, type AuthContext } from '@/lib/auth'
import { ycDelete, isYcPath, stripYcPrefix } from '@/lib/storage'
import { renderPreviewSvg } from '@/lib/album-builder/render-preview-svg'
import { validatePreset } from '@/lib/presets/validate'
import { buildPresetPreviewBundle } from '@/lib/presets/preview-bundle'
import { loadBundle } from '@/lib/rule-engine/loaders'
import { prepareTemplateSetClone } from '@/lib/template-set-clone'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ============================================================
// Хелпер: проверка, что альбом принадлежит tenant'у
// ============================================================
async function assertAlbumAccess(auth: AuthContext, albumId: string, tenantIdOverride?: string): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('albums')
    .select('tenant_id')
    .eq('id', albumId)
    .single()

  return data?.tenant_id === (tenantIdOverride ?? auth.tenantId)
}

// ============================================================
// РЭ.24.4: легковесная конвертация preset-row из БД в Preset
// для validatePreset. Не пытается полностью восстановить Preset
// (это делает presetRowToPreset в loaders.ts) — только поля
// которые проверяет валидатор.
// ============================================================
function rowToPresetForValidation(row: any) {
  return {
    id: row.id,
    display_name: row.display_name ?? '',
    print_type: row.print_type,
    pages_per_spread: row.pages_per_spread ?? 2,
    version: row.version ?? '1.0',
    sections: row.sections ?? [],
    tenant_id: row.tenant_id ?? null,
    template_set_id: row.template_set_id ?? null,
    section_structure: row.section_structure ?? null,
    student_layout_mode: row.student_layout_mode ?? null,
    student_grid_size: row.student_grid_size ?? null,
  } as any
}

// ============================================================
// РЭ.24.4: короткое описание шаблона для карточки каталога.
// Собирается из ключевых полей: режим личного раздела + сетка
// + тип печати. Партнёр видит понятную сводку без необходимости
// смотреть детали.
// ============================================================
function rowToDescription(row: any): string {
  const parts: string[] = []
  if (row.student_layout_mode === 'grid' && row.student_grid_size) {
    parts.push(`${row.student_grid_size} учеников на странице`)
  } else if (row.student_layout_mode === 'page') {
    parts.push('1 ученик на странице')
  } else if (row.student_layout_mode === 'spread') {
    parts.push('1 ученик на развороте')
  }
  if (row.print_type === 'layflat') {
    parts.push('твёрдая обложка')
  } else if (row.print_type === 'soft') {
    parts.push('мягкая обложка')
  }
  return parts.length > 0 ? parts.join(', ') : ''
}

// ============================================================
// РЭ.21.7.3: валидация section_structure из body.
//
// Допустимая форма: массив объектов вида:
//   { type: 'soft_intro' | 'teachers' | 'students' | 'vignette' | 'soft_final' }
//   { type: 'common', slots: ('H' | 'Q' | 'FULL' | 'flex_A' | 'flex_B' | 'flex_C')[] }
//   { type: 'common', mode: 'auto', max_spreads: number } — РЭ.21.8.8
//
// Возвращает { ok: true, value } или { ok: false, error }.
// Намеренно строгая валидация — мусор в jsonb-поле приведёт к падению
// build engine'а на проде с непонятной ошибкой.
// ============================================================
const ALLOWED_SECTION_TYPES = new Set([
  'soft_intro', 'teachers', 'students', 'common', 'common_required',
  'common_additional', 'transition', 'vignette', 'soft_final',
])
const ALLOWED_SLOT_TYPES = new Set(['H', 'Q', 'FULL', 'flex_A', 'flex_B', 'flex_C'])
const ALLOWED_COMMON_MODES = new Set(['auto'])  // РЭ.21.8.8: пока только auto
                                                // (manual = старая форма со slots)

// ============================================================
// РЭ.21.7.5.1: валидатор density.
//
// Whitelist синхронизирован с типом PresetDensity в
// lib/rule-engine/types.ts и с CHECK constraint на колонке
// `presets.density` (миграция РЭ.20.2).
//
// Семантика: density — параметр секции 'students' (плотность портретов).
// На уровне БД сейчас хранится как preset.density (одно значение на пресет).
// В UI представлен как параметр секции — это "B-стиль на старте": деферим
// перенос в section.params.density на следующий шаг (когда понадобится
// несколько разных плотностей в одном пресете).
//
// Возможные значения:
//   - 'standard' | 'universal' | 'medium' | 'light' | 'mini' — конкретная плотность
//   - null — не задана (build engine упадёт на фолбэк или будет работать без
//     student-секции)
// ============================================================
const ALLOWED_DENSITY_VALUES = new Set([
  'standard', 'universal', 'medium', 'light', 'mini',
])

function validateDensity(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'density должен быть строкой или null' }
  }
  if (!ALLOWED_DENSITY_VALUES.has(raw)) {
    return {
      ok: false,
      error: `Недопустимое значение density: '${raw}'. Допустимы: ${Array.from(ALLOWED_DENSITY_VALUES).join(', ')}`,
    }
  }
  return { ok: true, value: raw }
}

type ValidatedTransitionCustom = {
  tail_left: {
    left: { master_name: string }
    right: { master_name: string }
  }
  tail_right: {
    right: { master_name: string }
  }
}

type ValidatedSection =
  | { type: 'soft_intro' | 'teachers' | 'students' | 'vignette' | 'soft_final' }
  | { type: 'common'; slots: string[] }
  | { type: 'common'; mode: 'auto'; max_spreads: number }  // РЭ.21.8.8
  | { type: 'common_required'; pages?: { master_name: string }[] }  // РЭ.32: конструктор страниц
  | { type: 'common_additional'; max_spreads: number }     // РЭ.21.8.10
  // РЭ.32 legacy: { type: 'transition', master_name?: string | null }
  // РЭ.37: { type: 'transition', mode: 'okeybook_default' }
  //   | { type: 'transition', mode: 'custom', custom: ValidatedTransitionCustom }
  | { type: 'transition'; master_name?: string | null }
  | { type: 'transition'; mode: 'okeybook_default' }
  | { type: 'transition'; mode: 'custom'; custom: ValidatedTransitionCustom }

// РЭ.37: валидатор custom-сценария transition. Используется только когда
// section_structure[i] = { type: 'transition', mode: 'custom', custom }.
// Структура: { tail_left: { left, right }, tail_right: { right } } — каждый
// из left/right — это { master_name: string } (имя без суффикса '-Right').
function validateTransitionCustom(
  raw: unknown,
  sectionIdx: number,
): { ok: true; value: ValidatedTransitionCustom } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: `Секция #${sectionIdx + 1} (transition, custom): ожидался объект`,
    }
  }
  const r = raw as Record<string, unknown>
  const tlRaw = r.tail_left
  const trRaw = r.tail_right
  if (!tlRaw || typeof tlRaw !== 'object') {
    return {
      ok: false,
      error: `Секция #${sectionIdx + 1} (transition, custom): tail_left отсутствует или не объект`,
    }
  }
  if (!trRaw || typeof trRaw !== 'object') {
    return {
      ok: false,
      error: `Секция #${sectionIdx + 1} (transition, custom): tail_right отсутствует или не объект`,
    }
  }
  const tl = tlRaw as Record<string, unknown>
  const tr = trRaw as Record<string, unknown>
  const tlLeft = validateTransitionMasterRef(tl.left, sectionIdx, 'tail_left.left')
  if (!tlLeft.ok) return tlLeft
  const tlRight = validateTransitionMasterRef(tl.right, sectionIdx, 'tail_left.right')
  if (!tlRight.ok) return tlRight
  const trRight = validateTransitionMasterRef(tr.right, sectionIdx, 'tail_right.right')
  if (!trRight.ok) return trRight
  return {
    ok: true,
    value: {
      tail_left: { left: tlLeft.value, right: tlRight.value },
      tail_right: { right: trRight.value },
    },
  }
}

function validateTransitionMasterRef(
  raw: unknown,
  sectionIdx: number,
  path: string,
): { ok: true; value: { master_name: string } } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: `Секция #${sectionIdx + 1} (transition, custom.${path}): ожидался объект { master_name }`,
    }
  }
  const r = raw as { master_name?: unknown }
  if (
    typeof r.master_name !== 'string' ||
    r.master_name.length === 0 ||
    r.master_name.length > 200
  ) {
    return {
      ok: false,
      error: `Секция #${sectionIdx + 1} (transition, custom.${path}): master_name должен быть непустой строкой`,
    }
  }
  return { ok: true, value: { master_name: r.master_name } }
}

function validateSectionStructure(
  raw: unknown,
): { ok: true; value: ValidatedSection[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'section_structure должен быть массивом' }
  }
  if (raw.length > 50) {
    return { ok: false, error: 'Слишком много секций (максимум 50)' }
  }
  const result: ValidatedSection[] = []
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]
    if (!s || typeof s !== 'object') {
      return { ok: false, error: `Секция #${i + 1}: ожидался объект` }
    }
    const type = (s as { type?: unknown }).type
    if (typeof type !== 'string' || !ALLOWED_SECTION_TYPES.has(type)) {
      return { ok: false, error: `Секция #${i + 1}: недопустимый тип '${String(type)}'` }
    }
    if (type === 'common') {
      // Две допустимые формы common-секции:
      //   manual: { type: 'common', slots: [...] }       — старая, по умолчанию
      //   auto:   { type: 'common', mode: 'auto', max_spreads: N } — РЭ.21.8.8
      // Различаем по наличию поля mode. Если есть mode — auto, иначе manual.
      const mode = (s as { mode?: unknown }).mode
      if (mode !== undefined) {
        // auto-режим
        if (typeof mode !== 'string' || !ALLOWED_COMMON_MODES.has(mode)) {
          return {
            ok: false,
            error: `Секция #${i + 1} (common): недопустимый mode '${String(mode)}'. Допустимы: ${Array.from(ALLOWED_COMMON_MODES).join(', ')}`,
          }
        }
        const maxSpreads = (s as { max_spreads?: unknown }).max_spreads
        if (
          typeof maxSpreads !== 'number' ||
          !Number.isInteger(maxSpreads) ||
          maxSpreads < 0 ||
          maxSpreads > 20
        ) {
          return {
            ok: false,
            error: `Секция #${i + 1} (common, auto): max_spreads должен быть целым числом 0..20`,
          }
        }
        result.push({ type: 'common', mode: 'auto', max_spreads: maxSpreads })
      } else {
        // manual-режим (по умолчанию)
        const slots = (s as { slots?: unknown }).slots
        if (!Array.isArray(slots)) {
          return { ok: false, error: `Секция #${i + 1} (common): отсутствует массив slots` }
        }
        if (slots.length > 50) {
          return { ok: false, error: `Секция #${i + 1} (common): слишком много слотов` }
        }
        const validSlots: string[] = []
        for (let j = 0; j < slots.length; j++) {
          const slot = slots[j]
          if (typeof slot !== 'string' || !ALLOWED_SLOT_TYPES.has(slot)) {
            return {
              ok: false,
              error: `Секция #${i + 1}, слот #${j + 1}: недопустимое значение '${String(slot)}'`,
            }
          }
          validSlots.push(slot)
        }
        result.push({ type: 'common', slots: validSlots })
      }
    } else if (type === 'common_required') {
      // РЭ.32: партнёр в шаблоне задаёт упорядоченный список страниц
      // общего раздела. Engine исполняет список без интерпретации.
      // Поле pages опциональное (старые пресеты без него — engine
      // выдаёт warning 'общий раздел пуст').
      const pages = (s as { pages?: unknown }).pages
      if (pages === undefined || pages === null) {
        result.push({ type: 'common_required' })
      } else {
        if (!Array.isArray(pages)) {
          return {
            ok: false,
            error: `Секция #${i + 1} (common_required): pages должен быть массивом или отсутствовать`,
          }
        }
        if (pages.length > 50) {
          return {
            ok: false,
            error: `Секция #${i + 1} (common_required): слишком много страниц (максимум 50)`,
          }
        }
        const validPages: { master_name: string }[] = []
        for (let j = 0; j < pages.length; j++) {
          const p = pages[j] as { master_name?: unknown }
          if (
            !p ||
            typeof p !== 'object' ||
            typeof p.master_name !== 'string' ||
            p.master_name.length === 0 ||
            p.master_name.length > 200
          ) {
            return {
              ok: false,
              error: `Секция #${i + 1}, страница #${j + 1}: ожидается { master_name: string }`,
            }
          }
          validPages.push({ master_name: p.master_name })
        }
        result.push({ type: 'common_required', pages: validPages })
      }
    } else if (type === 'transition') {
      // РЭ.37: переходный раздел может быть в одной из трёх форм:
      //   (a) legacy РЭ.32:    { type: 'transition', master_name?: string|null }
      //   (b) РЭ.37 default:   { type: 'transition', mode: 'okeybook_default' }
      //   (c) РЭ.37 custom:    { type: 'transition', mode: 'custom', custom: {...} }
      //
      // Различаем по наличию поля mode. master_name и mode одновременно
      // не допускаются (явный конфликт legacy и нового формата).
      const masterName = (s as { master_name?: unknown }).master_name
      const mode = (s as { mode?: unknown }).mode
      const customRaw = (s as { custom?: unknown }).custom

      if (mode !== undefined && mode !== null) {
        // РЭ.37 форма (b) или (c).
        if (
          typeof mode !== 'string' ||
          (mode !== 'okeybook_default' && mode !== 'custom')
        ) {
          return {
            ok: false,
            error: `Секция #${i + 1} (transition): недопустимый mode '${String(mode)}'. Допустимы: okeybook_default, custom`,
          }
        }
        if (masterName !== undefined && masterName !== null) {
          return {
            ok: false,
            error: `Секция #${i + 1} (transition): нельзя одновременно задавать master_name (legacy РЭ.32) и mode (РЭ.37). Используйте только mode.`,
          }
        }
        if (mode === 'okeybook_default') {
          if (customRaw !== undefined && customRaw !== null) {
            return {
              ok: false,
              error: `Секция #${i + 1} (transition): поле custom задаётся только при mode='custom'`,
            }
          }
          result.push({ type: 'transition', mode: 'okeybook_default' })
        } else {
          // mode === 'custom' — custom обязателен
          const v = validateTransitionCustom(customRaw, i)
          if (!v.ok) return v
          result.push({ type: 'transition', mode: 'custom', custom: v.value })
        }
      } else {
        // legacy форма РЭ.32 (master_name? — опциональный)
        if (customRaw !== undefined && customRaw !== null) {
          return {
            ok: false,
            error: `Секция #${i + 1} (transition): поле custom требует mode='custom'`,
          }
        }
        if (masterName === undefined || masterName === null) {
          result.push({ type: 'transition' })
        } else if (
          typeof masterName !== 'string' ||
          masterName.length === 0 ||
          masterName.length > 200
        ) {
          return {
            ok: false,
            error: `Секция #${i + 1} (transition): master_name должен быть непустой строкой или null`,
          }
        } else {
          result.push({ type: 'transition', master_name: masterName })
        }
      }
    } else if (type === 'common_additional') {
      // РЭ.21.8.10: дополнительный общий раздел (платная допуслуга).
      // Параметр max_spreads — целое 0..20.
      const maxSpreads = (s as { max_spreads?: unknown }).max_spreads
      if (
        typeof maxSpreads !== 'number' ||
        !Number.isInteger(maxSpreads) ||
        maxSpreads < 0 ||
        maxSpreads > 20
      ) {
        return {
          ok: false,
          error: `Секция #${i + 1} (common_additional): max_spreads должен быть целым числом 0..20`,
        }
      }
      result.push({ type: 'common_additional', max_spreads: maxSpreads })
    } else {
      result.push({
        type: type as 'soft_intro' | 'teachers' | 'students' | 'vignette' | 'soft_final',
      })
    }
  }
  return { ok: true, value: result }
}

// ============================================================
// Хелпер: проверка, что ребёнок принадлежит альбому tenant'а
// ============================================================
async function assertChildAccess(auth: AuthContext, childId: string): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('children')
    .select('albums!inner(tenant_id)')
    .eq('id', childId)
    .single()

  return (data as any)?.albums?.tenant_id === auth.tenantId
}

// ============================================================
// Хелпер: проверка, что учитель принадлежит альбому tenant'а
// ============================================================
async function assertTeacherAccess(auth: AuthContext, teacherId: string): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('teachers')
    .select('albums!inner(tenant_id)')
    .eq('id', teacherId)
    .single()

  return (data as any)?.albums?.tenant_id === auth.tenantId
}

// ============================================================
// Хелпер: проверка, что фото принадлежит альбому tenant'а
// Возвращает saved photo row (вместе с storage_path и thumb_path), либо null
// ============================================================
async function getOwnedPhoto(auth: AuthContext, photoId: string) {
  const { data } = await supabaseAdmin
    .from('photos')
    .select('id, album_id, storage_path, thumb_path, filename, type, albums!inner(tenant_id)')
    .eq('id', photoId)
    .single()

  if (!data) return null
  if (auth.role === 'superadmin') return data as any
  if ((data as any).albums?.tenant_id !== auth.tenantId) return null
  return data as any
}

// ============================================================
// Хелпер: проверка, что ответственный родитель принадлежит альбому tenant'а
// ============================================================
async function assertResponsibleAccess(auth: AuthContext, responsibleId: string): Promise<boolean> {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('responsible_parents')
    .select('albums!inner(tenant_id)')
    .eq('id', responsibleId)
    .single()

  return (data as any)?.albums?.tenant_id === auth.tenantId
}

// ============================================================
// Хелпер: резолв preset_slug → preset record (для create_album/update_album)
// ============================================================
async function resolvePresetBySlug(slug: string): Promise<{
  id: string
  slug: string
  print_type: string
} | null> {
  const { data, error } = await supabaseAdmin
    .from('config_presets')
    .select('id, slug, print_type')
    .eq('slug', slug)
    .is('tenant_id', null)
    .single()

  if (error || !data) return null
  return data
}

// ============================================================
// Хелпер: ID единственного глобального template_set (okeybook-default)
// Используется при создании/обновлении альбома если template_set_id ещё NULL.
// В фазе 4 (расширение библиотеки) этот хардкод заменится на UI выбор.
// ============================================================
async function getDefaultTemplateSetId(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('template_sets')
    .select('id')
    .eq('slug', 'okeybook-default')
    .is('tenant_id', null)
    .single()

  if (error || !data) return null
  return data.id
}

// ============================================================
// GET /api/tenant — данные своего арендатора
// ============================================================
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager', 'viewer'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')
  const albumId = req.nextUrl.searchParams.get('album_id')
  // view_as позволяет суперадмину и сотрудникам OkeyBook смотреть кабинет партнёра
  const viewAsTenantId = req.nextUrl.searchParams.get('view_as')
  // Проверяем что текущий пользователь в main тенанте
  const { data: currentTenantData } = viewAsTenantId
    ? await supabaseAdmin.from('tenants').select('slug').eq('id', auth.tenantId).single()
    : { data: null }
  const canViewAs = auth.role === 'superadmin' || currentTenantData?.slug === 'main'
  const tid = (canViewAs && viewAsTenantId) ? viewAsTenantId : auth.tenantId

  // ----------------------------------------------------------
  // partners_list — список партнёров для сотрудников OkeyBook
  // ----------------------------------------------------------
  if (action === 'partners_list') {
    // Только для сотрудников главного тенанта
    const { data: tenantData } = await supabaseAdmin
      .from('tenants').select('slug').eq('id', tid).single()
    const isMain = tenantData?.slug === 'main' || auth.role === 'superadmin'
    if (!isMain) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const query = supabaseAdmin
      .from('tenants')
      .select('id, name, slug, city, is_active, assigned_manager_id')
      .neq('slug', 'main')
      .eq('is_active', true)
      .order('name')

    // owner и manager OkeyBook видят только назначенных им партнёров
    // (если assigned_manager_id не пустой — фильтруем по нему)
    if (auth.role !== 'superadmin') {
      query.eq('assigned_manager_id', auth.userId)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ tenants: data ?? [] })
  }

  // ----------------------------------------------------------
  // dashboard — общая информация для главного экрана
  // ----------------------------------------------------------
  if (action === 'dashboard') {
    // Альбомы tenant'а со статистикой
    const [albumsRes, childrenRes, teacherTokensRes, teachersRes, leadsRes] = await Promise.all([
      supabaseAdmin
        .from('albums')
        .select('*, config_presets(slug, name)')
        .eq('tenant_id', tid)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('children')
        .select('album_id, submitted_at, started_at, is_purchased, albums!inner(tenant_id)')
        .eq('albums.tenant_id', tid),
      supabaseAdmin
        .from('responsible_parents')
        .select('album_id, access_token, albums!inner(tenant_id)')
        .eq('albums.tenant_id', tid),
      supabaseAdmin
        .from('teachers')
        .select('album_id, submitted_at, albums!inner(tenant_id)')
        .eq('albums.tenant_id', tid),
      supabaseAdmin
        .from('referral_leads')
        .select('id, status')
        .eq('tenant_id', tid),
    ])

    const albums = albumsRes.data ?? []

    // Статистика по альбомам
    const statsMap: Record<string, { total: number; submitted: number; in_progress: number; purchased: number }> = {}
    for (const c of childrenRes.data ?? []) {
      if (!statsMap[c.album_id]) statsMap[c.album_id] = { total: 0, submitted: 0, in_progress: 0, purchased: 0 }
      statsMap[c.album_id].total++
      if (c.submitted_at) statsMap[c.album_id].submitted++
      else if (c.started_at) statsMap[c.album_id].in_progress++
      // РЭ.25: считаем заказчиков. is_purchased!==false → заказывает
      // (default true, бэк-совместимость с не-мигрированной БД).
      if ((c as any).is_purchased !== false) statsMap[c.album_id].purchased++
    }

    const tokenMap: Record<string, string> = {}
    for (const t of teacherTokensRes.data ?? []) tokenMap[t.album_id] = t.access_token

    const teacherMap: Record<string, { total: number; done: number }> = {}
    for (const t of teachersRes.data ?? []) {
      if (!teacherMap[t.album_id]) teacherMap[t.album_id] = { total: 0, done: 0 }
      teacherMap[t.album_id].total++
      if (t.submitted_at) teacherMap[t.album_id].done++
    }

    // Глобальные цифры
    const albumsActive = albums.filter(a => !a.archived).length
    const totalChildren = (childrenRes.data ?? []).length
    const totalSubmitted = (childrenRes.data ?? []).filter(c => c.submitted_at).length
    const leads = leadsRes.data ?? []
    const newLeads = leads.filter(l => l.status === 'new').length

    // Проверяем по slug — надёжнее чем сравнение с env переменной
    const { data: tenantData } = await supabaseAdmin
      .from('tenants').select('slug').eq('id', tid).single()
    const isMainTenant = tenantData?.slug === 'main'
    return NextResponse.json({
      albums: albums.map(a => {
        const preset = (a as { config_presets?: { slug: string; name: string } | null }).config_presets ?? null
        return {
          ...a,
          config_preset_slug: preset?.slug ?? null,
          config_preset_name: preset?.name ?? null,
          stats: statsMap[a.id] ?? { total: 0, submitted: 0, in_progress: 0, purchased: 0 },
          teacher_token: tokenMap[a.id] ?? null,
          teachers: teacherMap[a.id] ?? null,
        }
      }),
      summary: {
        albums_total: albums.length,
        albums_active: albumsActive,
        albums_archived: albums.length - albumsActive,
        children_total: totalChildren,
        children_submitted: totalSubmitted,
        leads_total: leads.length,
        leads_new: newLeads,
      },
      isMainTenant,
    })
  }

  // ----------------------------------------------------------
  // album — данные конкретного альбома (с проверкой доступа)
  // ----------------------------------------------------------
  if (action === 'album' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data: album } = await supabaseAdmin
      .from('albums')
      .select('*')
      .eq('id', albumId)
      .single()

    // РЭ.27.4: добавляем вычисленный effective_print_type для UI.
    // Логика та же что в layout API: album.print_type приоритетнее,
    // fallback на preset.print_type, дефолт 'layflat'. Это позволяет
    // layout viewer'у показывать визуальные форзацы для soft без
    // дублирования логики resolve на клиенте.
    let effectivePrintType: 'layflat' | 'soft' = 'layflat'
    if (album) {
      const albumPt = (album as { print_type?: string | null }).print_type
      if (albumPt === 'layflat' || albumPt === 'soft') {
        effectivePrintType = albumPt
      } else {
        // Fallback: посмотреть в связанном пресете.
        // - section_structure_preset_id → 'presets' таблица (РЭ.21+,
        //   связь по uuid, БЕЗ slug-колонки).
        // - config_preset_id → 'config_presets' таблица (legacy,
        //   связь по slug-string).
        // ⚠️ Это РАЗНЫЕ ТАБЛИЦЫ (открыто 21.05.2026 при работе над 27.7).
        //   Раньше в этом блоке ошибочно стояло '.from(presets).eq(slug, ...)' —
        //   запрос падал т.к. в 'presets' нет slug, и effectivePrintType
        //   оставался 'layflat' независимо от реального значения.
        const ssId = (album as { section_structure_preset_id?: string | null })
          .section_structure_preset_id
        const cfgId = (album as { config_preset_id?: string | null })
          .config_preset_id
        if (ssId) {
          const { data: ps } = await supabaseAdmin
            .from('presets')
            .select('print_type')
            .eq('id', ssId)
            .maybeSingle()
          const psPt = (ps as { print_type?: string | null } | null)?.print_type
          if (psPt === 'layflat' || psPt === 'soft') effectivePrintType = psPt
        } else if (cfgId) {
          const { data: ps } = await supabaseAdmin
            .from('config_presets')
            .select('print_type')
            .eq('slug', cfgId)
            .maybeSingle()
          const psPt = (ps as { print_type?: string | null } | null)?.print_type
          if (psPt === 'layflat' || psPt === 'soft') effectivePrintType = psPt
        }
      }
    }

    return NextResponse.json({
      ...album,
      effective_print_type: effectivePrintType,
    })
  }

  // ----------------------------------------------------------
  // album_stats — детальная статистика по альбому
  // ----------------------------------------------------------
  if (action === 'album_stats' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const [children, teachers, surcharges] = await Promise.all([
      supabaseAdmin.from('children').select('id, submitted_at, started_at, is_purchased').eq('album_id', albumId),
      supabaseAdmin.from('teachers').select('id, submitted_at').eq('album_id', albumId),
      supabaseAdmin
        .from('cover_selections')
        .select('surcharge, child_id, children!inner(album_id)')
        .eq('children.album_id', albumId)
        .gt('surcharge', 0),
    ])

    const ch = children.data ?? []
    const tch = teachers.data ?? []
    const surch = surcharges.data ?? []

    return NextResponse.json({
      total: ch.length,
      submitted: ch.filter((c: any) => c.submitted_at).length,
      in_progress: ch.filter((c: any) => !c.submitted_at && c.started_at).length,
      not_started: ch.filter((c: any) => !c.submitted_at && !c.started_at).length,
      // РЭ.25: счётчик заказчиков. is_purchased!==false → заказывает.
      purchased: ch.filter((c: any) => c.is_purchased !== false).length,
      teachers_total: tch.length,
      teachers_done: tch.filter((t: any) => t.submitted_at).length,
      surcharge_total: surch.reduce((sum: number, s: any) => sum + (s.surcharge ?? 0), 0),
      surcharge_count: surch.length,
    })
  }

  // ----------------------------------------------------------
  // children — список учеников альбома
  // ----------------------------------------------------------
  if (action === 'children' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data: children } = await supabaseAdmin
      .from('children')
      .select('id, full_name, class, access_token, submitted_at, started_at, is_purchased, config_preset_id, config_presets(slug, name)')
      .eq('album_id', albumId)
      .order('class')
      .order('full_name')

    const ids = (children ?? []).map((c: any) => c.id)

    if (ids.length === 0) {
      return NextResponse.json([])
    }

    const [contacts, covers] = await Promise.all([
      supabaseAdmin
        .from('parent_contacts')
        .select('child_id, parent_name, phone')
        .in('child_id', ids),
      supabaseAdmin
        .from('cover_selections')
        .select('child_id, cover_option, surcharge')
        .in('child_id', ids),
    ])

    const contactMap = Object.fromEntries((contacts.data ?? []).map((c: any) => [c.child_id, c]))
    const coverMap = Object.fromEntries((covers.data ?? []).map((c: any) => [c.child_id, c]))

    return NextResponse.json(
      (children ?? []).map((c: any) => {
        const preset = c.config_presets ?? null
        const { config_presets, ...rest } = c
        return {
          ...rest,
          config_preset_id: c.config_preset_id ?? null,
          config_preset_slug: preset?.slug ?? null,
          config_preset_name: preset?.name ?? null,
          contact: contactMap[c.id] ?? null,
          cover: coverMap[c.id] ?? null,
        }
      })
    )
  }

  // ----------------------------------------------------------
  // child_details — выбор конкретного ученика (фото, текст, контакт)
  // ----------------------------------------------------------
  if (action === 'child_details') {
    const childId = req.nextUrl.searchParams.get('child_id')
    if (!childId) return NextResponse.json({ error: 'Нет child_id' }, { status: 400 })

    // Проверяем принадлежность ребёнка tenant'у
    const { data: childCheck } = await supabaseAdmin
      .from('children')
      .select('id, albums!inner(tenant_id)')
      .eq('id', childId)
      .single()
    if (!childCheck || (auth.role !== 'superadmin' && (childCheck as any).albums?.tenant_id !== tid)) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    const [selectionsRes, textRes, contactRes, coverRes, spreadRes] = await Promise.all([
      supabaseAdmin.from('selections').select('photo_id, selection_type, photos(filename, storage_path, thumb_path)').eq('child_id', childId),
      supabaseAdmin.from('student_texts').select('text').eq('child_id', childId).maybeSingle(),
      supabaseAdmin.from('parent_contacts').select('parent_name, phone').eq('child_id', childId).maybeSingle(),
      supabaseAdmin.from('cover_selections').select('cover_option, surcharge').eq('child_id', childId).maybeSingle(),
      supabaseAdmin.from('personal_spread_photos').select('id, filename, storage_path, width, height, file_size, sort_order').eq('child_id', childId).order('sort_order'),
    ])

    const selections = (selectionsRes.data ?? []).map((s: any) => ({
      type: s.selection_type,
      filename: s.photos?.filename ?? '',
      url: s.photos?.storage_path ? getPhotoUrl(s.photos.storage_path) : '',
      thumb: getThumbUrl(s.photos?.storage_path ?? '', s.photos?.thumb_path ?? null),
    }))

    const spreadPhotos = (spreadRes.data ?? []).map((p: any) => ({
      id: p.id,
      filename: p.filename,
      url: getPhotoUrl(p.storage_path),
      width: p.width,
      height: p.height,
      file_size: p.file_size,
    }))

    return NextResponse.json({
      selections,
      text: textRes.data?.text ?? '',
      contact: contactRes.data ?? null,
      cover: coverRes.data ?? null,
      spreadPhotos,
    })
  }

  // ----------------------------------------------------------
  // templates — шаблоны альбомов (свои + глобальные)
  // ----------------------------------------------------------
  if (action === 'templates') {
    const { data } = await supabaseAdmin
      .from('album_templates')
      .select('*')
      .or(`tenant_id.is.null,tenant_id.eq.${tid}`)
      .order('created_at')

    return NextResponse.json(data ?? [])
  }

  // ----------------------------------------------------------
  // РЭ.32.Б.3 — template_set_masters — список мастеров указанного
  // template_set'а. Используется в PresetEditorModal для конструктора
  // общего раздела (JMasterPicker + CommonRequiredPagesEditor).
  //
  // Доступ:
  //   - global template_sets (tenant_id IS NULL) — все
  //   - tenant template_sets — только если tenant_id совпадает
  //
  // Возвращает [{ id, name, page_role, is_spread, width_mm, height_mm,
  //               placeholders, slot_capacity, applies_to_configs,
  //               default_for_configs, mirror_for_soft, type, sort_order,
  //               is_fallback, audit_notes, display_label, rules }]
  // (полный SpreadTemplate, как ожидает AlbumSpreadCanvas).
  // ----------------------------------------------------------
  if (action === 'template_set_masters') {
    const tsId = req.nextUrl.searchParams.get('template_set_id')
    if (!tsId) {
      return NextResponse.json(
        { error: 'template_set_id required' },
        { status: 400 },
      )
    }

    // 1) Проверка доступа
    const { data: ts, error: tsErr } = await supabaseAdmin
      .from('template_sets')
      .select('id, tenant_id')
      .eq('id', tsId)
      .single()
    if (tsErr || !ts) {
      return NextResponse.json(
        { error: 'template_set не найден' },
        { status: 404 },
      )
    }
    const tsTenantId = (ts as { tenant_id: string | null }).tenant_id
    if (tsTenantId !== null && tsTenantId !== tid && auth.role !== 'superadmin') {
      return NextResponse.json(
        { error: 'нет доступа к этому template_set' },
        { status: 403 },
      )
    }

    // 2) Список мастеров
    const { data: masters, error: mErr } = await supabaseAdmin
      .from('spread_templates')
      .select(
        'id, name, display_label, template_set_id, page_role, slot_capacity, ' +
          'is_spread, width_mm, height_mm, placeholders, rules, sort_order, ' +
          'applies_to_configs, default_for_configs, is_fallback, mirror_for_soft, audit_notes, type',
      )
      .eq('template_set_id', tsId)
      .order('name')

    if (mErr) {
      return NextResponse.json({ error: mErr.message }, { status: 500 })
    }

    return NextResponse.json({ masters: masters ?? [] })
  }

  // ----------------------------------------------------------
  // presets_list — глобальные config_presets для UI dropdown'ов
  // ----------------------------------------------------------
  if (action === 'presets_list') {
    const { data, error } = await supabaseAdmin
      .from('config_presets')
      .select('id, slug, name, description, print_type, config')
      .is('tenant_id', null)
      .order('slug')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ presets: data ?? [] })
  }

  // ----------------------------------------------------------
  // rule_presets_list (РЭ.21.3) — список пресетов из таблицы `presets`.
  // Раньше использовалось только rule engine'ом (движок 2, удалён в
  // РЭ.21.8.чистка-1). Теперь это общая таблица для section_structure
  // engine (движок 3) — имя action оставлено для совместимости с UI.
  // Используется в модале «Пресеты» в /app — просмотр структуры альбома
  // для каждого пресета.
  //
  // ВАЖНО: это РАЗНЫЕ таблицы. `config_presets` — legacy движок,
  // `presets` — section_structure (РЭ.21.8).
  // ----------------------------------------------------------
  if (action === 'rule_presets_list') {
    const { data, error } = await supabaseAdmin
      .from('presets')
      .select('id, display_name, print_type, density, sheet_type, min_pages, max_pages, template_set_id, section_structure, student_pages_per_student, student_friend_photos, student_has_quote, student_layout_mode, student_grid_size, symmetrize_students_tail, transition_scenario, tenant_id, version, is_recommended')
      .or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
      .order('display_name')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ presets: data ?? [] })
  }

  // ----------------------------------------------------------
  // template_set_list_with_previews (РЭ.23.3) — список мастеров
  // template_set'а с автогенерированными SVG-превью для admin-tool
  // /super/master-catalog.
  //
  // Доступ только админам/суперадминам (не viewer, не партнёрский UI).
  // Tenant-aware: возвращает мастера template_set'ов которые принадлежат
  // текущему tenant'у ИЛИ глобальным (tenant_id=NULL у template_set).
  // Для суперадмина — все template_set'ы.
  //
  // SVG-превью рендерится синхронно через renderPreviewSvg (чистая
  // функция, без I/O). Размер ~1-3 KB на мастер.
  // ----------------------------------------------------------
  if (action === 'template_set_list_with_previews') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }

    // 1) Выбираем template_set'ы доступные тенант'у (свои + глобальные).
    let templateSetsQuery = supabaseAdmin
      .from('template_sets')
      .select('id, name, slug, tenant_id')
    if (auth.role !== 'superadmin') {
      templateSetsQuery = templateSetsQuery.or(
        `tenant_id.is.null,tenant_id.eq.${auth.tenantId}`,
      )
    }
    const { data: templateSets, error: tsErr } = await templateSetsQuery
    if (tsErr) {
      return NextResponse.json({ error: tsErr.message }, { status: 500 })
    }
    const tsIds = (templateSets ?? []).map((t: any) => t.id)
    if (tsIds.length === 0) {
      return NextResponse.json({ masters: [] })
    }

    // 2) Выбираем мастера этих template_set'ов.
    const { data: masters, error: mErr } = await supabaseAdmin
      .from('spread_templates')
      .select(
        'id, name, display_label, template_set_id, page_role, slot_capacity, ' +
          'is_spread, width_mm, height_mm, placeholders, rules, sort_order, ' +
          'applies_to_configs, default_for_configs, is_fallback, mirror_for_soft, audit_notes, type',
      )
      .in('template_set_id', tsIds)
      .order('name')
    if (mErr) {
      return NextResponse.json({ error: mErr.message }, { status: 500 })
    }

    // 3) Рендерим SVG-превью для каждого мастера.
    const result = (masters ?? []).map((m: any) => {
      // renderPreviewSvg ждёт SpreadTemplate — собираем минимально-нужное
      // подмножество полей (функция использует только placeholders +
      // width_mm/height_mm + is_spread).
      const template = {
        id: m.id,
        name: m.name,
        type: m.type ?? 'common',
        is_spread: m.is_spread === true,
        width_mm: m.width_mm,
        height_mm: m.height_mm,
        placeholders: Array.isArray(m.placeholders) ? m.placeholders : [],
        rules: m.rules ?? null,
        sort_order: m.sort_order ?? 0,
        applies_to_configs: m.applies_to_configs ?? [],
        default_for_configs: m.default_for_configs ?? [],
        page_role: m.page_role ?? null,
        slot_capacity: m.slot_capacity ?? null,
        is_fallback: m.is_fallback ?? false,
        mirror_for_soft: m.mirror_for_soft ?? false,
        audit_notes: m.audit_notes ?? null,
      }
      return {
        id: m.id,
        name: m.name,
        display_label: m.display_label ?? null,
        template_set_id: m.template_set_id,
        page_role: m.page_role ?? null,
        slot_capacity: m.slot_capacity ?? null,
        is_spread: m.is_spread === true,
        preview_svg: renderPreviewSvg(template),
      }
    })

    return NextResponse.json({
      masters: result,
      template_sets: templateSets ?? [],
    })
  }

  // ----------------------------------------------------------
  // designs_list (РЭ.24.5b) — список доступных дизайнов
  // (template_set'ов) для каталога /app/templates.
  //
  // Возвращает: свои (tenant_id=auth.tenantId) + глобальные (tenant_id=NULL)
  // template_set'ы. Для каждого:
  //   • счётчики: сколько recommended-глобальных шаблонов и сколько
  //     моих шаблонов привязано к этому дизайну
  //   • до 3 SVG-превью характерных мастеров (для карточки дизайна)
  //   • основные метаданные template_set'а
  //
  // Если template_set не имеет ни одного recommended-шаблона ни одного
  // партнёрского — он всё равно показывается (дизайн доступен для
  // создания пустого шаблона с нуля).
  //
  // Доступ: любой авторизованный с tenantId.
  // ----------------------------------------------------------
  if (action === 'designs_list') {
    if (!auth.tenantId) {
      return NextResponse.json({ error: 'Не задан tenant' }, { status: 400 })
    }

    // 1) Все доступные template_set'ы.
    // Не-superadmin не видит технические тестовые наборы (name LIKE 'TEST%').
    // Это template_set'ы из РЭ.22 (балансировочные тесты engine'а),
    // которые нужны Сергею для отладки, но не для партнёров.
    let tsQuery = supabaseAdmin
      .from('template_sets')
      .select('id, name, slug, tenant_id, print_type, page_width_mm, page_height_mm')
    if (auth.role !== 'superadmin') {
      tsQuery = tsQuery
        .or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
        .not('name', 'ilike', 'TEST%')
    }
    const { data: tsRows, error: tsErr } = await tsQuery.order('name')
    if (tsErr) {
      return NextResponse.json({ error: tsErr.message }, { status: 500 })
    }
    const tsIds = (tsRows ?? []).map((t: any) => t.id)
    if (tsIds.length === 0) {
      return NextResponse.json({ designs: [] })
    }

    // 2) Счётчики recommended-шаблонов (глобальных) по каждому template_set.
    const { data: globalCounts } = await supabaseAdmin
      .from('presets')
      .select('template_set_id')
      .is('tenant_id', null)
      .eq('is_recommended', true)
      .in('template_set_id', tsIds)
    const globalCountByTs = new Map<string, number>()
    for (const row of globalCounts ?? []) {
      const k = (row as any).template_set_id
      if (k) globalCountByTs.set(k, (globalCountByTs.get(k) ?? 0) + 1)
    }

    // 3) Счётчики моих шаблонов по каждому template_set.
    const { data: myCounts } = await supabaseAdmin
      .from('presets')
      .select('template_set_id')
      .eq('tenant_id', auth.tenantId)
      .in('template_set_id', tsIds)
    const myCountByTs = new Map<string, number>()
    for (const row of myCounts ?? []) {
      const k = (row as any).template_set_id
      if (k) myCountByTs.set(k, (myCountByTs.get(k) ?? 0) + 1)
    }

    // 4) До 3 характерных мастеров каждого template_set'а для превью.
    // Берём те у которых page_role задан (значит мастер уже размечен,
    // не служебный) и предпочитаем student_grid > student_left > teacher_left.
    const { data: allMasters } = await supabaseAdmin
      .from('spread_templates')
      .select('id, name, template_set_id, page_role, is_spread, width_mm, height_mm, placeholders')
      .in('template_set_id', tsIds)
      .order('name')

    const mastersByTs = new Map<string, any[]>()
    for (const m of allMasters ?? []) {
      const k = (m as any).template_set_id
      if (!k) continue
      if (!mastersByTs.has(k)) mastersByTs.set(k, [])
      mastersByTs.get(k)!.push(m)
    }

    // 5) Собираем итог.
    const PRIORITY_ROLES = ['student_grid', 'student_left', 'teacher_left', 'cover', 'intro']
    const results = (tsRows ?? []).map((ts: any) => {
      const masters = mastersByTs.get(ts.id) ?? []
      // Сортируем по приоритету ролей, потом по имени
      const sorted = masters
        .filter((m) => m.page_role) // только размеченные
        .sort((a, b) => {
          const ai = PRIORITY_ROLES.indexOf(a.page_role)
          const bi = PRIORITY_ROLES.indexOf(b.page_role)
          const ax = ai < 0 ? 999 : ai
          const bx = bi < 0 ? 999 : bi
          if (ax !== bx) return ax - bx
          return String(a.name).localeCompare(String(b.name))
        })
        .slice(0, 3)

      const previews: string[] = []
      for (const m of sorted) {
        const template = {
          id: m.id,
          name: m.name,
          type: 'common' as const,
          is_spread: m.is_spread === true,
          width_mm: m.width_mm,
          height_mm: m.height_mm,
          placeholders: Array.isArray(m.placeholders) ? m.placeholders : [],
          rules: null,
          sort_order: 0,
          applies_to_configs: [],
          default_for_configs: [],
          page_role: m.page_role ?? null,
          slot_capacity: null,
          is_fallback: false,
          mirror_for_soft: false,
          audit_notes: null,
        }
        try {
          previews.push(renderPreviewSvg(template))
        } catch {
          // молча пропускаем
        }
      }

      return {
        id: ts.id,
        name: ts.name,
        slug: ts.slug,
        tenant_id: ts.tenant_id,
        is_global: ts.tenant_id === null,
        print_type: ts.print_type,
        page_width_mm: ts.page_width_mm,
        page_height_mm: ts.page_height_mm,
        recommended_count: globalCountByTs.get(ts.id) ?? 0,
        my_count: myCountByTs.get(ts.id) ?? 0,
        previews,
      }
    })

    return NextResponse.json({ designs: results })
  }

  // ----------------------------------------------------------
  // /app/templates. Возвращает только is_recommended=true.
  //
  // РЭ.24.5b: добавлен параметр ?design_id=... для фильтрации по
  // конкретному дизайну (template_set_id). Если не указан — возвращает
  // все рекомендованные шаблоны (для совместимости с прежним поведением).
  //
  // Для каждого шаблона:
  //   • validatePreset → отбрасываем невалидные (с warning в логе)
  //   • loadBundle → buildPresetPreviewBundle → 4 SVG
  //
  // Доступ: любой авторизованный (включая партнёров с ролью viewer —
  // им можно просто посмотреть каталог, клонировать они не смогут).
  // ----------------------------------------------------------
  if (action === 'templates_list_global') {
    const designId = req.nextUrl.searchParams.get('design_id')
    let query = supabaseAdmin
      .from('presets')
      .select('*')
      .is('tenant_id', null)
      .eq('is_recommended', true)
    if (designId) {
      query = query.eq('template_set_id', designId)
    }
    const { data: rows, error: loadErr } = await query.order('display_name')
    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }

    const results = []
    for (const row of rows ?? []) {
      // Конвертируем row → Preset (по минимуму, чтобы validatePreset работал).
      const preset = rowToPresetForValidation(row)
      const validation = validatePreset(preset)
      if (!validation.valid) {
        console.warn(
          `[templates_list_global] preset '${preset.id}' (${preset.display_name}) невалиден, пропускаем:`,
          validation.errors,
        )
        continue
      }

      // Рендерим превью.
      let previews: { students: string | null; cover: string | null; teachers: string | null; soft: string | null } =
        { students: null, cover: null, teachers: null, soft: null }
      try {
        const bundle = await loadBundle(supabaseAdmin, preset.id, null)
        previews = buildPresetPreviewBundle(bundle)
      } catch (e) {
        console.warn(`[templates_list_global] loadBundle failed for '${preset.id}':`, e)
      }

      results.push({
        id: preset.id,
        display_name: preset.display_name,
        description: rowToDescription(row),
        print_type: preset.print_type,
        sheet_type: row.sheet_type ?? null,
        student_layout_mode: preset.student_layout_mode ?? null,
        student_grid_size: preset.student_grid_size ?? null,
        min_pages: row.min_pages ?? null,
        max_pages: row.max_pages ?? null,
        template_set_id: row.template_set_id ?? null,
        previews,
      })
    }

    return NextResponse.json({ templates: results })
  }

  // ----------------------------------------------------------
  // templates_list_my (РЭ.24.4) — личная библиотека партнёра.
  // SELECT * FROM presets WHERE tenant_id = auth.tenantId.
  //
  // РЭ.24.5b: параметр ?design_id=... для фильтрации по template_set.
  //
  // Для каждого:
  //   • validatePreset → флаг valid + errors[]
  //   • Если valid → buildPresetPreviewBundle → 4 SVG
  //   • Если невалиден → превью пустые (4 null), UI пометит 'Доработай'
  //
  // Доступ: любой авторизованный с tenantId (включая viewer — увидит
  // только просмотр, без действий).
  // ----------------------------------------------------------
  if (action === 'templates_list_my') {
    if (!auth.tenantId) {
      return NextResponse.json({ error: 'Не задан tenant' }, { status: 400 })
    }

    const designId = req.nextUrl.searchParams.get('design_id')
    let query = supabaseAdmin
      .from('presets')
      .select('*')
      .eq('tenant_id', auth.tenantId)
    if (designId) {
      query = query.eq('template_set_id', designId)
    }
    const { data: rows, error: loadErr } = await query.order('display_name')
    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }

    const results = []
    for (const row of rows ?? []) {
      const preset = rowToPresetForValidation(row)
      const validation = validatePreset(preset)

      let previews: { students: string | null; cover: string | null; teachers: string | null; soft: string | null } =
        { students: null, cover: null, teachers: null, soft: null }
      if (validation.valid) {
        try {
          const bundle = await loadBundle(supabaseAdmin, preset.id, auth.tenantId)
          previews = buildPresetPreviewBundle(bundle)
        } catch (e) {
          console.warn(`[templates_list_my] loadBundle failed for '${preset.id}':`, e)
        }
      }

      results.push({
        id: preset.id,
        display_name: preset.display_name,
        description: rowToDescription(row),
        print_type: preset.print_type,
        sheet_type: row.sheet_type ?? null,
        student_layout_mode: preset.student_layout_mode ?? null,
        student_grid_size: preset.student_grid_size ?? null,
        min_pages: row.min_pages ?? null,
        max_pages: row.max_pages ?? null,
        template_set_id: row.template_set_id ?? null,
        parent_preset_id: row.parent_preset_id ?? null,
        valid: validation.valid,
        errors: validation.errors,
        previews,
      })
    }

    return NextResponse.json({ templates: results })
  }

  // ----------------------------------------------------------
  // РЭ.28.3: template_set_my_list — клоны template_set'ов партнёра.
  //
  // Возвращает партнёру список template_set'ов с tenant_id = его id
  // (т.е. клоны которые он сделал в РЭ.28). Глобальные сюда НЕ
  // включаются — для них есть существующий designs_list, который
  // отдаёт «свои + глобальные» вперемешку. UI в /app/templates
  // использует designs_list для основного каталога, а этот endpoint —
  // если нужен отдельный «только мои» список (например для странички
  // управления своими дизайнами).
  //
  // Также возвращает parent_template_set_id чтобы UI мог отобразить
  // «создано на основе ХХХ» (название источника подтянет отдельно
  // или берёт из designs_list).
  // ----------------------------------------------------------
  if (action === 'template_set_my_list') {
    if (!auth.tenantId) {
      return NextResponse.json({ error: 'Не задан tenant' }, { status: 400 })
    }

    const { data: rows, error: loadErr } = await supabaseAdmin
      .from('template_sets')
      .select(
        'id, name, slug, tenant_id, parent_template_set_id, print_type, ' +
          'page_width_mm, page_height_mm, spread_width_mm, spread_height_mm, ' +
          'bleed_mm, facing_pages, page_binding, description, created_at',
      )
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: false })

    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }

    return NextResponse.json({ template_sets: rows ?? [] })
  }

  // ----------------------------------------------------------
  // teachers — список учителей альбома
  // ----------------------------------------------------------
  if (action === 'teachers' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data: teachers } = await supabaseAdmin
      .from('teachers')
      .select('id, full_name, position, description, access_token, submitted_at, created_at, is_head_teacher')
      .eq('album_id', albumId)
      .order('created_at')

    const teacherIds = (teachers ?? []).map((t: any) => t.id)
    const { data: photoLinks } = teacherIds.length > 0
      ? await supabaseAdmin
          .from('photo_teachers')
          .select('teacher_id, photos(filename, storage_path)')
          .in('teacher_id', teacherIds)
      : { data: [] }

    const photoByTeacher: Record<string, { filename: string | null; storage_path: string | null }> = {}
    for (const link of photoLinks ?? []) {
      const ph = (link as any).photos
      if (ph) {
        photoByTeacher[(link as any).teacher_id] = {
          filename: ph.filename ?? null,
          storage_path: ph.storage_path ?? null,
        }
      }
    }

    const enriched = (teachers ?? []).map((t: any) => ({
      ...t,
      photo_storage_path: photoByTeacher[t.id]?.storage_path ?? null,
      photo_filename: photoByTeacher[t.id]?.filename ?? null,
    }))

    return NextResponse.json(enriched)
  }

  // ----------------------------------------------------------
  // responsible — ответственный родитель альбома
  // ----------------------------------------------------------
  if (action === 'responsible' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data } = await supabaseAdmin
      .from('responsible_parents')
      .select('id, full_name, phone, access_token, submitted_at, created_at')
      .eq('album_id', albumId)
      .maybeSingle()

    return NextResponse.json(data ?? null)
  }

  // ----------------------------------------------------------
  // photos — список фото альбома (с опциональным фильтром по типу и тегами)
  // ----------------------------------------------------------
  if (action === 'photos' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const photoType = req.nextUrl.searchParams.get('photo_type')

    let query = supabaseAdmin
      .from('photos')
      .select('id, filename, storage_path, thumb_path, type, original_path, created_at')
      .eq('album_id', albumId)
      .order('created_at')

    if (photoType) query = query.eq('type', photoType)

    const { data: photos, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Привязки фото к детям (только для portrait/group)
    let tagsByPhoto: Record<string, string[]> = {}
    if (!photoType || photoType === 'portrait' || photoType === 'group') {
      const photoIds = (photos ?? []).map((p: any) => p.id)
      if (photoIds.length > 0) {
        const { data: links } = await supabaseAdmin
          .from('photo_children')
          .select('photo_id, children(full_name)')
          .in('photo_id', photoIds)
        for (const link of links ?? []) {
          const name = (link as any).children?.full_name ?? ''
          if (!tagsByPhoto[(link as any).photo_id]) tagsByPhoto[(link as any).photo_id] = []
          tagsByPhoto[(link as any).photo_id].push(name)
        }
      }
    }

    const result = (photos ?? []).map((p: any) => ({
      id: p.id,
      filename: p.filename,
      storage_path: p.storage_path,
      thumb_path: p.thumb_path,
      type: p.type,
      // П.3 — для UI бейджика «нет оригинала» в галерее. Boolean
      // вместо самого пути — defence in depth (партнёр не должен
      // видеть internal YC paths).
      has_original: Boolean(p.original_path),
      url: getPhotoUrl(p.storage_path),
      thumb_url: getThumbUrl(p.storage_path, p.thumb_path),
      tags: tagsByPhoto[p.id] ?? [],
    }))

    return NextResponse.json({ photos: result })
  }

  // ----------------------------------------------------------
  // album_photos — единый список всех фото альбома для палитры
  // будущего редактора (фаза 2.4 / phase-2-spec §4.1).
  //
  // Объединяет два источника:
  //   - photos (с типом portrait/group/teacher, привязками, селекшенами)
  //   - original_photos (оригиналы фотографа из workflow)
  //
  // Для photos подтягивает:
  //   - child_ids[] из photo_children
  //   - teacher_ids[] из photo_teachers
  //   - selection_types[] из selections (distinct)
  //
  // Для original_photos все привязки/селекшены пусты, type=null.
  // ----------------------------------------------------------
  if (action === 'album_photos' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // 1. Параллельная загрузка из всех источников.
    const [photosRes, originalsRes] = await Promise.all([
      supabaseAdmin
        .from('photos')
        .select('id, filename, storage_path, thumb_path, type, original_path, created_at')
        .eq('album_id', albumId)
        .order('created_at'),
      supabaseAdmin
        .from('original_photos')
        .select('id, filename, storage_path, file_size, created_at')
        .eq('album_id', albumId)
        .order('created_at'),
    ])

    if (photosRes.error) {
      return NextResponse.json({ error: photosRes.error.message }, { status: 500 })
    }
    if (originalsRes.error) {
      return NextResponse.json({ error: originalsRes.error.message }, { status: 500 })
    }

    const photos = photosRes.data ?? []
    const originals = originalsRes.data ?? []
    const photoIds = photos.map((p: any) => p.id)

    // 2. Подгрузить связи и селекшены параллельно (только если есть photos).
    const [childLinksRes, teacherLinksRes, selectionsRes] = photoIds.length > 0
      ? await Promise.all([
          supabaseAdmin
            .from('photo_children')
            .select('photo_id, child_id')
            .in('photo_id', photoIds),
          supabaseAdmin
            .from('photo_teachers')
            .select('photo_id, teacher_id')
            .in('photo_id', photoIds),
          supabaseAdmin
            .from('selections')
            .select('photo_id, selection_type')
            .in('photo_id', photoIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ]

    // Ошибки джоинов не валим запрос — просто отдаём фото с пустыми связями.
    // Если что-то пошло не так — это видно в логах Vercel; UI сможет
    // показать фото без привязок (читабельно деградировать).

    // 3. Группировка связей по photo_id.
    const childIdsByPhoto: Record<string, string[]> = {}
    for (const link of childLinksRes.data ?? []) {
      const pid = (link as any).photo_id as string
      const cid = (link as any).child_id as string
      if (!childIdsByPhoto[pid]) childIdsByPhoto[pid] = []
      childIdsByPhoto[pid].push(cid)
    }

    const teacherIdsByPhoto: Record<string, string[]> = {}
    for (const link of teacherLinksRes.data ?? []) {
      const pid = (link as any).photo_id as string
      const tidRow = (link as any).teacher_id as string
      if (!teacherIdsByPhoto[pid]) teacherIdsByPhoto[pid] = []
      teacherIdsByPhoto[pid].push(tidRow)
    }

    // selection_types: distinct через Set, потом обратно в массив.
    const selectionTypesByPhoto: Record<string, Set<string>> = {}
    for (const sel of selectionsRes.data ?? []) {
      const pid = (sel as any).photo_id as string
      const stype = (sel as any).selection_type as string
      if (!selectionTypesByPhoto[pid]) selectionTypesByPhoto[pid] = new Set()
      selectionTypesByPhoto[pid].add(stype)
    }

    // 4. Сборка результата: photos + originals в одном массиве.
    const fromPhotos = photos.map((p: any) => ({
      id: p.id,
      filename: p.filename,
      storage_path: p.storage_path,
      thumb_path: p.thumb_path,
      type: p.type as 'portrait' | 'group' | 'teacher' | 'common_spread' | 'common_full' | 'common_half' | 'common_quarter' | 'common_sixth',
      source: 'selections' as const,
      child_ids: childIdsByPhoto[p.id] ?? [],
      teacher_ids: teacherIdsByPhoto[p.id] ?? [],
      selection_types: Array.from(selectionTypesByPhoto[p.id] ?? []),
      // Л.2 — для UI «Заменить оригинал» нужно знать есть ли оригинал
      // у фото. Просто boolean, без раскрытия пути (defence in depth).
      has_original: Boolean(p.original_path),
      url: getPhotoUrl(p.storage_path),
      thumb_url: getThumbUrl(p.storage_path, p.thumb_path),
      created_at: p.created_at,
    }))

    const fromOriginals = originals.map((o: any) => ({
      id: o.id,
      filename: o.filename,
      storage_path: o.storage_path,
      thumb_path: null,
      type: null,
      source: 'originals' as const,
      child_ids: [] as string[],
      teacher_ids: [] as string[],
      selection_types: [] as string[],
      has_original: false,  // originals — это и есть оригиналы, поле для photos.original_path
      url: getPhotoUrl(o.storage_path),
      thumb_url: getPhotoUrl(o.storage_path),  // у originals нет thumb_path
      created_at: o.created_at,
    }))

    return NextResponse.json({
      photos: [...fromPhotos, ...fromOriginals],
    })
  }

  // ----------------------------------------------------------
  // leads — список реферальных заявок tenant'а
  // Возвращает заявки с именем реферера и названием альбома
  // (чтобы понять откуда пришла заявка).
  // ----------------------------------------------------------
  if (action === 'leads') {
    let query = supabaseAdmin
      .from('referral_leads')
      .select('id, name, phone, city, school, class_name, status, created_at, referrer_child_id')
      .order('created_at', { ascending: false })

    if (auth.role !== 'superadmin') {
      query = query.eq('tenant_id', tid)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const childIds = Array.from(
      new Set((data ?? []).map((d: any) => d.referrer_child_id).filter(Boolean))
    )

    const [childrenRes, contactsRes] = childIds.length > 0
      ? await Promise.all([
          supabaseAdmin.from('children').select('id, full_name, album_id').in('id', childIds),
          supabaseAdmin.from('parent_contacts').select('child_id, parent_name').in('child_id', childIds),
        ])
      : [{ data: [] }, { data: [] }]

    const childMap = Object.fromEntries(
      (childrenRes.data ?? []).map((c: any) => [c.id, c])
    )
    const contactMap = Object.fromEntries(
      (contactsRes.data ?? []).map((c: any) => [c.child_id, c.parent_name])
    )

    const albumIds = Array.from(
      new Set((childrenRes.data ?? []).map((c: any) => c.album_id).filter(Boolean))
    )
    const { data: albums } = albumIds.length > 0
      ? await supabaseAdmin.from('albums').select('id, title').in('id', albumIds)
      : { data: [] }
    const albumMap = Object.fromEntries((albums ?? []).map((a: any) => [a.id, a.title]))

    const leads = (data ?? []).map((d: any) => ({
      ...d,
      referrer_name:
        contactMap[d.referrer_child_id] ||
        childMap[d.referrer_child_id]?.full_name ||
        '—',
      referrer_album: albumMap[childMap[d.referrer_child_id]?.album_id] || '',
    }))

    return NextResponse.json(leads)
  }

  // ----------------------------------------------------------
  // quotes — список цитат (свои tenant + глобальные)
  // Обогащено: use_count — сколько раз цитата была выбрана
  // детьми этого tenant'а (для статистики и для owner — прежде
  // чем удалять цитату, понятно, используют ли её).
  // is_global — флаг, чтобы UI отличал глобальные (read-only)
  // от собственных (editable).
  // ----------------------------------------------------------
  if (action === 'quotes') {
    const { data: quotes, error } = await supabaseAdmin
      .from('quotes')
      .select('id, text, category, tenant_id, created_at')
      .or(`tenant_id.is.null,tenant_id.eq.${tid}`)
      .order('category')
      .order('created_at')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Подсчёт use_count — через JOIN с albums по tenant_id,
    // чтобы считать только выборы из альбомов этого tenant'а
    const quoteIds = (quotes ?? []).map((q: any) => q.id)
    let useCountMap: Record<string, number> = {}

    if (quoteIds.length > 0) {
      let selQuery = supabaseAdmin
        .from('quote_selections')
        .select('quote_id, albums!inner(tenant_id)')
        .in('quote_id', quoteIds)

      if (auth.role !== 'superadmin') {
        selQuery = selQuery.eq('albums.tenant_id', tid)
      }

      const { data: sels } = await selQuery
      for (const s of sels ?? []) {
        const qid = (s as any).quote_id
        useCountMap[qid] = (useCountMap[qid] ?? 0) + 1
      }
    }

    const result = (quotes ?? []).map((q: any) => ({
      id: q.id,
      text: q.text,
      category: q.category,
      is_global: q.tenant_id === null,
      created_at: q.created_at,
      use_count: useCountMap[q.id] ?? 0,
    }))

    return NextResponse.json(result)
  }

  // ----------------------------------------------------------
  // users — список сотрудников tenant'а (только owner и superadmin)
  // ----------------------------------------------------------
  if (action === 'users') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может управлять командой' }, { status: 403 })
    }

    let query = supabaseAdmin
      .from('users')
      .select('id, email, full_name, role, is_active, last_login, created_at')
      .neq('role', 'superadmin') // superadmin'ов не показываем в списке команды
      .order('created_at')

    if (auth.role !== 'superadmin') {
      query = query.eq('tenant_id', tid)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data ?? [])
  }

  // ----------------------------------------------------------
  // invitations — список активных (непринятых, не просроченных) приглашений
  // ----------------------------------------------------------
  if (action === 'invitations') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может управлять командой' }, { status: 403 })
    }

    let query = supabaseAdmin
      .from('invitations')
      .select('id, email, role, token, expires_at, accepted_at, created_at, invited_by')
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (auth.role !== 'superadmin') {
      query = query.eq('tenant_id', tid)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Подтягиваем имена пригласивших для UI
    const inviterIds = Array.from(
      new Set((data ?? []).map((i: any) => i.invited_by).filter(Boolean))
    )
    const { data: inviters } = inviterIds.length > 0
      ? await supabaseAdmin.from('users').select('id, full_name, email').in('id', inviterIds)
      : { data: [] }
    const inviterMap = Object.fromEntries(
      (inviters ?? []).map((u: any) => [u.id, u])
    )

    const result = (data ?? []).map((i: any) => ({
      ...i,
      invited_by_name: inviterMap[i.invited_by]?.full_name ?? inviterMap[i.invited_by]?.email ?? null,
    }))

    return NextResponse.json(result)
  }

  // ----------------------------------------------------------
  // tenant_settings — данные своего арендатора (для формы настроек)
  // Доступно всем ролям (viewer тоже может просматривать),
  // редактирование — только owner (update_tenant_settings).
  // ----------------------------------------------------------
  if (action === 'tenant_settings') {
    if (auth.role === 'superadmin') {
      return NextResponse.json({ error: 'Superadmin использует /super' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, logo_url, city, phone, email, plan, plan_expires, max_albums, max_storage_mb, settings, is_active, created_at')
      .eq('id', tid)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data)
  }

  // Совместим со старым /api/admin?action=export по ключевым колонкам:
  // Класс, Ученик, Портрет_страница, Обложка, Портрет_обложка, Текст,
  // ----------------------------------------------------------
  // analytics — сводная аналитика по всем альбомам tenant'а
  // + динамика submitted_at/started_at по дням для конкретного альбома
  // ----------------------------------------------------------
  // ----------------------------------------------------------
  // personal_spread_stats — статистика по личным разворотам альбома
  // для вкладки "Разворот" в AlbumDetailModal
  // ----------------------------------------------------------
  if (action === 'personal_spread_stats' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }
    const { data, error } = await supabaseAdmin
      .from('personal_spread_photos')
      .select('child_id, filename, storage_path, sort_order, id, children(full_name, class)')
      .eq('album_id', albumId)
      .order('sort_order')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Группируем по ученику
    const byChild: Record<string, {
      child_id: string; full_name: string; class: string
      photos: { id: string; filename: string; storage_path: string; sort_order: number }[]
    }> = {}
    for (const p of data ?? []) {
      const ch = (p as any).children
      if (!byChild[p.child_id]) {
        byChild[p.child_id] = {
          child_id: p.child_id,
          full_name: ch?.full_name ?? '',
          class: ch?.class ?? '',
          photos: [],
        }
      }
      byChild[p.child_id].photos.push({
        id: p.id,
        filename: p.filename,
        storage_path: p.storage_path,
        sort_order: p.sort_order,
      })
    }
    return NextResponse.json({ children: Object.values(byChild) })
  }

  if (action === 'analytics') {
    // Все дети по всем активным альбомам tenant'а
    const { data: allChildren } = await supabaseAdmin
      .from('children')
      .select('album_id, submitted_at, started_at, albums!inner(id, title, city, year, archived, tenant_id, deadline)')
      .eq('albums.tenant_id', tid)
      .eq('albums.archived', false)

    const children = allChildren ?? []

    // Группируем по альбому
    const albumMap: Record<string, {
      album_id: string
      title: string
      city: string
      year: number
      deadline: string | null
      total: number
      submitted: number
      in_progress: number
      not_started: number
    }> = {}

    for (const c of children) {
      const alb = (c as any).albums
      if (!alb) continue
      if (!albumMap[c.album_id]) {
        albumMap[c.album_id] = {
          album_id: c.album_id,
          title: alb.title,
          city: alb.city ?? '',
          year: alb.year,
          deadline: alb.deadline ?? null,
          total: 0,
          submitted: 0,
          in_progress: 0,
          not_started: 0,
        }
      }
      const a = albumMap[c.album_id]
      a.total++
      if (c.submitted_at) a.submitted++
      else if (c.started_at) a.in_progress++
      else a.not_started++
    }

    const albums_stats = Object.values(albumMap)
      .sort((a, b) => b.submitted - a.submitted)

    // Динамика по дням — если запрошен конкретный альбом
    let daily: { date: string; submitted: number; started: number }[] = []
    if (albumId) {
      if (!(await assertAlbumAccess(auth, albumId, tid))) {
        return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
      }
      const albumChildren = children.filter(c => c.album_id === albumId)

      // Собираем все даты событий
      const dateMap: Record<string, { submitted: number; started: number }> = {}
      for (const c of albumChildren) {
        if (c.submitted_at) {
          const d = c.submitted_at.slice(0, 10)
          if (!dateMap[d]) dateMap[d] = { submitted: 0, started: 0 }
          dateMap[d].submitted++
        }
        if (c.started_at) {
          const d = c.started_at.slice(0, 10)
          if (!dateMap[d]) dateMap[d] = { submitted: 0, started: 0 }
          dateMap[d].started++
        }
      }
      daily = Object.entries(dateMap)
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    // Итого по всему тенанту
    const total_all = children.length
    const submitted_all = children.filter(c => c.submitted_at).length
    const in_progress_all = children.filter(c => !c.submitted_at && c.started_at).length
    const not_started_all = children.filter(c => !c.submitted_at && !c.started_at).length

    return NextResponse.json({
      summary: { total: total_all, submitted: submitted_all, in_progress: in_progress_all, not_started: not_started_all },
      albums: albums_stats,
      daily,
    })
  }

  // Фото_друзья_1..10
  // Добавлены справа: Статус, Родитель, Телефон, Доплата
  // Учителя идут в конце после пустой строки-разделителя с Класс=УЧИТЕЛЬ
  // ----------------------------------------------------------
  if (action === 'export_csv' && albumId) {
    if (!(await assertAlbumAccess(auth, albumId, tid))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data: album } = await supabaseAdmin
      .from('albums')
      .select('title, city, year, template_title')
      .eq('id', albumId)
      .single()

    const { data: children } = await supabaseAdmin
      .from('children')
      .select('id, full_name, class, submitted_at, started_at, is_purchased')
      .eq('album_id', albumId)
      .order('class')
      .order('full_name')

    const ids = (children ?? []).map((c: any) => c.id)

    const [selectionsRes, contactsRes, textsRes, coversRes, spreadRes] = ids.length > 0
      ? await Promise.all([
          supabaseAdmin.from('selections').select('child_id, photo_id, selection_type, photos(filename)').in('child_id', ids),
          supabaseAdmin.from('parent_contacts').select('child_id, parent_name, phone').in('child_id', ids),
          supabaseAdmin.from('student_texts').select('child_id, text').in('child_id', ids),
          supabaseAdmin.from('cover_selections').select('child_id, cover_option, surcharge').in('child_id', ids),
          supabaseAdmin.from('personal_spread_photos').select('child_id, filename').in('child_id', ids).order('sort_order'),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]

    const spreadMap: Record<string, string[]> = {}
    for (const p of (spreadRes as any).data ?? []) {
      if (!spreadMap[p.child_id]) spreadMap[p.child_id] = []
      spreadMap[p.child_id].push(p.filename)
    }

    const selMap: Record<string, any[]> = {}
    for (const s of selectionsRes.data ?? []) {
      if (!selMap[(s as any).child_id]) selMap[(s as any).child_id] = []
      selMap[(s as any).child_id].push(s)
    }
    const contactMap = Object.fromEntries((contactsRes.data ?? []).map((c: any) => [c.child_id, c]))
    const textMap = Object.fromEntries((textsRes.data ?? []).map((t: any) => [t.child_id, t.text]))
    const coverMap = Object.fromEntries((coversRes.data ?? []).map((c: any) => [c.child_id, c]))

    const statusLabel = (c: any): string => {
      if (c.submitted_at) return 'Завершил'
      if (c.started_at) return 'В процессе'
      return 'Не начал'
    }

    const rows = (children ?? []).map((c: any) => {
      const sels = selMap[c.id] ?? []
      const pp = sels.find((s: any) => s.selection_type === 'portrait_page')
      const pc = sels.find((s: any) => s.selection_type === 'portrait_cover')
      const gr = sels.filter((s: any) => s.selection_type === 'group')
      const cover = coverMap[c.id]
      const contact = contactMap[c.id]

      const grCols: Record<string, string> = {}
      for (let i = 0; i < 10; i++) {
        grCols[`Фото_друзья_${i + 1}`] = gr[i] ? (gr[i] as any).photos?.filename ?? '' : ''
      }

      return {
        Класс: c.class ?? '',
        Ученик: c.full_name ?? '',
        // РЭ.25: колонка для скрипта автовёрстки InDesign.
        // 'да' = заказывает (default true), 'нет' = не заказывает.
        // Скрипт может фильтровать строки с 'нет' если нужно
        // пропустить их в личном разделе.
        Заказ: c.is_purchased === false ? 'нет' : 'да',
        Портрет_страница: (pp as any)?.photos?.filename ?? '',
        Обложка: cover?.cover_option ?? 'none',
        Портрет_обложка: pc
          ? (pc as any).photos?.filename
          : (cover?.cover_option === 'same' ? (pp as any)?.photos?.filename ?? '' : ''),
        Текст: textMap[c.id] ?? '',
        ...grCols,
        ...Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [
            `Личный_${i + 1}`,
            spreadMap[c.id]?.[i] ?? '',
          ])
        ),
        Статус: statusLabel(c),
        Родитель: contact?.parent_name ?? '',
        Телефон: contact?.phone ?? '',
        Доплата: cover?.surcharge ? String(cover.surcharge) : '',
        Комплектация: (album as any)?.template_title ?? '',
      }
    })

    // Учителя
    const { data: teachers } = await supabaseAdmin
      .from('teachers')
      .select('id, full_name, position, description')
      .eq('album_id', albumId)
      .order('created_at')

    const teacherIds = (teachers ?? []).map((t: any) => t.id)
    const { data: photoLinks } = teacherIds.length > 0
      ? await supabaseAdmin
          .from('photo_teachers')
          .select('teacher_id, photos(filename)')
          .in('teacher_id', teacherIds)
      : { data: [] }

    const photoByTeacher: Record<string, any> = {}
    for (const link of photoLinks ?? []) {
      photoByTeacher[(link as any).teacher_id] = (link as any).photos
    }

    const teacherRows = (teachers ?? []).map((t: any) => {
      const photo = photoByTeacher[t.id]
      const grTeacherCols: Record<string, string> = {}
      for (let i = 0; i < 10; i++) { grTeacherCols[`Фото_друзья_${i + 1}`] = '' }
      const spreadTeacherCols: Record<string, string> = {}
      for (let i = 0; i < 12; i++) { spreadTeacherCols[`Личный_${i + 1}`] = '' }
      return {
        Класс: 'УЧИТЕЛЬ',
        Ученик: t.full_name ?? '',
        // РЭ.25: для учителей колонка не имеет смысла, ставим '—'.
        Заказ: '—',
        Портрет_страница: photo?.filename ?? '',
        Обложка: t.position ?? '',
        Портрет_обложка: '',
        Текст: t.description ?? '',
        ...grTeacherCols,
        ...spreadTeacherCols,
        Статус: photo ? 'Заполнено' : 'Ожидание',
        Родитель: '',
        Телефон: '',
        Доплата: '',
        Комплектация: (album as any)?.template_title ?? '',
      }
    })

    const allRows = [
      ...rows,
      ...(teacherRows.length > 0 ? [null as any, ...teacherRows] : []),
    ]

    const headers = Object.keys(rows[0] ?? teacherRows[0] ?? {})
    if (headers.length === 0) {
      return NextResponse.json({ error: 'Альбом пуст — нечего экспортировать' }, { status: 400 })
    }

    // META-строка для скрипта автовёрстки InDesign
    // Формат: META,город,название школы,год,,,... (пустые колонки до конца)
    const metaCols = ['META', (album as any)?.city ?? '', (album as any)?.title ?? '', String((album as any)?.year ?? '')]
    while (metaCols.length < headers.length) metaCols.push('')
    const metaRow = metaCols.map(v => `"${v.replace(/"/g, '""')}"`).join(',')

    const csv = [
      metaRow,
      headers.join(','),
      ...allRows.map(r =>
        r === null
          ? headers.map(() => '""').join(',')
          : headers.map(h => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n')

    // Имя файла: title-city-year.csv, со слагификацией
    const slugify = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9а-яё\s-]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60)

    const parts = [
      slugify((album as any)?.title ?? 'album'),
      (album as any)?.city ? slugify((album as any).city) : '',
      (album as any)?.year ? String((album as any).year) : '',
    ].filter(Boolean)
    const filename = parts.join('-') + '.csv'

    await logAction(auth, 'album.export_csv', 'album', albumId, {
      rows: rows.length,
      teachers: teacherRows.length,
    })

    return new NextResponse('\uFEFF' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}

// ============================================================
// POST /api/tenant — мутации (создание/редактирование альбомов)
// ============================================================

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

  const contentType = req.headers.get('content-type') ?? ''

  // ============================================================
  // multipart/form-data — загрузка файлов
  // Разветвление по action-полю формы:
  //   upload_photo (default) — фото альбома
  //   upload_logo — логотип tenant'а
  // ============================================================
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const formAction = (form.get('action') as string | null) ?? 'upload_photo'

    // ----------------------------------------------------------
    // upload_logo — логотип tenant'а (только owner)
    // Формат: file
    // Делает WebP 256x256 (fit=cover, attention), кладёт в
    // photos/tenants/<tenant_id>/logo.webp, перезаписывает старый,
    // сохраняет путь в tenants.logo_url.
    // ----------------------------------------------------------
    if (formAction === 'upload_logo') {
      if (auth.role !== 'owner' && auth.role !== 'superadmin') {
        return NextResponse.json(
          { error: 'Только владелец может менять логотип' },
          { status: 403 }
        )
      }

      const file = form.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'Файл обязателен' }, { status: 400 })
      }
      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json(
          { error: 'Размер файла не должен превышать 5 МБ' },
          { status: 400 }
        )
      }

      const sharp = (await import('sharp')).default
      const buffer = Buffer.from(await file.arrayBuffer())

      let processed: Buffer
      try {
        processed = await sharp(buffer)
          .rotate()
          .resize(256, 256, { fit: 'cover', position: 'attention' })
          .webp({ quality: 90 })
          .toBuffer()
      } catch {
        return NextResponse.json({ error: 'Не удалось обработать изображение' }, { status: 400 })
      }

      const logoPath = `tenants/${auth.tenantId}/logo.webp`

      // Старый путь может отличаться (если раньше был с timestamp или другим расширением)
      const { data: currentTenant } = await supabaseAdmin
        .from('tenants')
        .select('logo_url')
        .eq('id', auth.tenantId)
        .single()
      const oldPath = (currentTenant as any)?.logo_url
      if (oldPath && oldPath !== logoPath) {
        await supabaseAdmin.storage.from('photos').remove([oldPath])
      }

      // upsert=true, чтобы перезаписывать
      const { error: upErr } = await supabaseAdmin.storage
        .from('photos')
        .upload(logoPath, processed, {
          contentType: 'image/webp',
          upsert: true,
        })

      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      }

      const { error: dbErr } = await supabaseAdmin
        .from('tenants')
        .update({ logo_url: logoPath })
        .eq('id', auth.tenantId)

      if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

      // Public URL (обходим кэш CDN с timestamp'ом, чтобы UI сразу увидел новый логотип)
      const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${logoPath}?t=${Date.now()}`

      await logAction(auth, 'tenant.upload_logo', 'tenant', auth.tenantId, {
        size: file.size,
      })

      return NextResponse.json({ ok: true, logo_url: logoPath, public_url: publicUrl })
    }

    // ----------------------------------------------------------
    // upload_photo (default multipart action) — фото альбома
    // Формат: file, type, album_id
    // type ∈ {portrait, group, teacher,
    //         common_spread, common_full, common_half,
    //         common_quarter, common_sixth}.
    // Делает WebP full (2048px) + thumb (400px) через sharp,
    // заливает оба в Storage, создаёт запись в photos.
    // ----------------------------------------------------------
    const file = form.get('file') as File | null
    const type = form.get('type') as string | null
    const albumId = form.get('album_id') as string | null

    if (!file || !type || !albumId) {
      return NextResponse.json({ error: 'Не хватает данных (file, type, album_id)' }, { status: 400 })
    }

    if (!['portrait', 'group', 'teacher',
          'common_spread', 'common_full', 'common_half',
          'common_quarter', 'common_sixth'].includes(type)) {
      return NextResponse.json({ error: 'Неверный type' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, albumId))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Проверим, что альбом не в архиве
    const { data: album } = await supabaseAdmin
      .from('albums')
      .select('archived')
      .eq('id', albumId)
      .single()
    if ((album as any)?.archived) {
      return NextResponse.json({ error: 'Нельзя загружать фото в архивный альбом' }, { status: 403 })
    }

    const sharp = (await import('sharp')).default
    const buffer = Buffer.from(await file.arrayBuffer())
    const originalName = file.name.replace(/\.[^.]+$/, '')

    const sharpInstance = sharp(buffer).rotate()

    const [fullBuffer, thumbBuffer] = await Promise.all([
      sharpInstance.clone()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer(),
      sharpInstance.clone()
        .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer(),
    ])

    const timestamp = Date.now()
    const fullPath  = `${albumId}/${type}/${timestamp}_${originalName}.webp`
    const thumbPath = `${albumId}/${type}/thumbs/${timestamp}_${originalName}.webp`

    const [fullUpload, thumbUpload] = await Promise.all([
      supabaseAdmin.storage.from('photos').upload(fullPath, fullBuffer, { contentType: 'image/webp', upsert: false }),
      supabaseAdmin.storage.from('photos').upload(thumbPath, thumbBuffer, { contentType: 'image/webp', upsert: false }),
    ])

    if (fullUpload.error) {
      return NextResponse.json({ error: fullUpload.error.message }, { status: 500 })
    }

    const { data: photo, error: dbError } = await supabaseAdmin
      .from('photos')
      .insert({
        album_id: albumId,
        filename: file.name,
        storage_path: fullPath,
        thumb_path: thumbUpload.error ? null : thumbPath,
        type,
      })
      .select()
      .single()

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

    await logAction(auth, 'photo.upload', 'photo', (photo as any).id, {
      album_id: albumId,
      type,
      filename: file.name,
    })

    return NextResponse.json(photo)
  }

  const body = await req.json()

  // ----------------------------------------------------------
  // rule_preset_create (РЭ.21.4) — создание нового пресета rule engine.
  // Доступно для owner/manager текущего тенанта. tenant_id=auth.tenantId.
  // Партнёр в форме указывает display_name + print_type + диапазон страниц
  // (min_pages..max_pages). Остальные поля получают разумные дефолты.
  //
  // РЭ.21.5.3: total_pages удалён из БД, пишем только min_pages/max_pages.
  // ----------------------------------------------------------
  if (body.action === 'rule_preset_create') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }

    const displayName = String(body.display_name ?? '').trim()
    const printType = String(body.print_type ?? '').trim()
    const minPages = Number(body.min_pages)
    const maxPages = Number(body.max_pages)

    if (!displayName) {
      return NextResponse.json({ error: 'Название обязательно' }, { status: 400 })
    }
    if (printType !== 'layflat' && printType !== 'soft') {
      return NextResponse.json(
        { error: 'Тип печати должен быть layflat или soft' },
        { status: 400 }
      )
    }
    if (!Number.isFinite(minPages) || minPages < 1 || minPages > 200) {
      return NextResponse.json(
        { error: 'Минимум страниц от 1 до 200' },
        { status: 400 }
      )
    }
    if (!Number.isFinite(maxPages) || maxPages < 1 || maxPages > 200) {
      return NextResponse.json(
        { error: 'Максимум страниц от 1 до 200' },
        { status: 400 }
      )
    }
    if (minPages > maxPages) {
      return NextResponse.json(
        { error: 'Минимум страниц не может быть больше максимума' },
        { status: 400 }
      )
    }

    // РЭ.21.6: template_set_id опциональный. Если передан — валидируем
    // что (а) это uuid, (б) тенанту реально доступен этот template_set
    // (глобальный или его собственный). Без проверки партнёр мог бы
    // сослаться на чужой template_set.
    let templateSetId: string | null = null
    if (body.template_set_id != null && body.template_set_id !== '') {
      const tsid = String(body.template_set_id)
      // Базовая sanity-проверка формата uuid (без жёсткого regex —
      // PostgreSQL отвергнет невалидное на этапе INSERT с ясной ошибкой).
      if (tsid.length < 32) {
        return NextResponse.json(
          { error: 'template_set_id должен быть uuid' },
          { status: 400 }
        )
      }
      const { data: tsRow, error: tsErr } = await supabaseAdmin
        .from('template_sets')
        .select('id, tenant_id, is_global')
        .eq('id', tsid)
        .maybeSingle()
      if (tsErr) {
        return NextResponse.json({ error: tsErr.message }, { status: 500 })
      }
      if (!tsRow) {
        return NextResponse.json(
          { error: 'Дизайн не найден' },
          { status: 400 }
        )
      }
      const accessible =
        tsRow.is_global === true ||
        tsRow.tenant_id === null ||
        tsRow.tenant_id === auth.tenantId
      if (!accessible) {
        return NextResponse.json(
          { error: 'Этот дизайн недоступен' },
          { status: 403 }
        )
      }
      templateSetId = tsid
    }

    // ID = slug + случайный суффикс (presets.id — text, не uuid).
    // Slug делаем латинскими — кириллица в id выглядит коряво в URL/логах.
    const randomSuffix = Math.random().toString(36).slice(2, 10)
    const id = `custom-${randomSuffix}`

    // sheet_type выводим из print_type. Позже переедет на уровень альбома (см. РЭ.12).
    const sheetType = printType === 'layflat' ? 'hard' : 'soft'

    // Дефолтная структура — простая, стартовая. Используется если клиент
    // не передал section_structure в body. РЭ.21.7.3: партнёр может
    // передать собственную структуру при создании.
    const defaultSectionStructure: ValidatedSection[] = [
      { type: 'soft_intro' },
      { type: 'teachers' },
      { type: 'students' },
      { type: 'common', slots: ['H', 'flex_A', 'flex_A', 'flex_B'] },
      { type: 'soft_final' },
    ]
    let sectionStructure: ValidatedSection[] = defaultSectionStructure
    if (body.section_structure !== undefined) {
      const v = validateSectionStructure(body.section_structure)
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 })
      }
      sectionStructure = v.value
    }

    // РЭ.21.7.5.1: density (опциональный). Если не передан — пишем null
    // (партнёр настроит позже через UI секции students). Если передан —
    // валидируем по whitelist.
    let density: string | null = null
    if (body.density !== undefined) {
      const v = validateDensity(body.density)
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 })
      }
      density = v.value
    }

    // sections — legacy поле для текущего rule engine. Используем минимальный
    // набор семейств (без params) — для legacy build это безопасный default.
    const defaultSections = [
      { family_id: 'head-teacher' },
      { family_id: 'student-section' },
      { family_id: 'common-section' },
    ]

    const { data: created, error } = await supabaseAdmin
      .from('presets')
      .insert({
        id,
        display_name: displayName,
        print_type: printType,
        pages_per_spread: 2,
        version: '1.0',
        min_pages: minPages,
        max_pages: maxPages,
        density: density,
        sheet_type: sheetType,
        section_structure: sectionStructure,
        sections: defaultSections,
        template_set_id: templateSetId,
        tenant_id: auth.tenantId,
        parent_preset_id: null,
      })
      .select('id, display_name')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, preset: created })
  }

  // ----------------------------------------------------------
  // rule_preset_update (РЭ.21.7.1) — частичное обновление пресета.
  //
  // Доступ:
  //   - Глобальные пресеты (tenant_id IS NULL): только superadmin.
  //     Сейчас superadmin сюда не ходит — это задел на будущее
  //     (UI редактирования глобалов в /super планируется отдельно).
  //   - Tenant-овские пресеты: owner/manager этого тенанта.
  //     viewer → 403. Чужой тенант → 404 (не раскрываем существование).
  //
  // Принимаемые поля (все опциональные — partial update):
  //   - display_name: trim, не пусто.
  //   - print_type: 'layflat' | 'soft'. При смене обновляем sheet_type
  //     (hard/soft соответственно) — consistent с rule_preset_create.
  //   - min_pages, max_pages: 1..200, min <= max. Если передан только
  //     один — валидируем относительно второго В БД (а не в body).
  //   - template_set_id: uuid или null. Валидируем доступ.
  //   - section_structure: массив (РЭ.21.7.3). Валидируется через
  //     validateSectionStructure. Каждый элемент {type} либо
  //     {type:'common', slots:[]}.
  //   - density (РЭ.21.7.5.1): 'standard'|'universal'|'medium'|'light'|'mini'
  //     или null. Валидируется через validateDensity. В UI представлен
  //     как параметр секции students (B-стиль на старте), но физически
  //     хранится как preset.density.
  //
  // НЕ принимаем (намеренно):
  //   - id, tenant_id, parent_preset_id, sections — иммутабельны.
  //   - version — внутренняя версия пресета, отдельная задача.
  // ----------------------------------------------------------
  if (body.action === 'rule_preset_update') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }

    const presetId = String(body.preset_id ?? '').trim()
    if (!presetId) {
      return NextResponse.json({ error: 'preset_id обязателен' }, { status: 400 })
    }

    // 1) Загружаем существующий пресет для проверки прав и для
    // cross-валидации min/max (если передано только одно поле).
    const { data: existing, error: loadErr } = await supabaseAdmin
      .from('presets')
      .select('id, tenant_id, min_pages, max_pages, print_type')
      .eq('id', presetId)
      .maybeSingle()
    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: 'Пресет не найден' }, { status: 404 })
    }

    // 2) Проверка владения. Глобальные (tenant_id=NULL) — только superadmin.
    // Чужие тенант'овские → 404 (скрываем существование).
    const isGlobalPreset = existing.tenant_id === null
    if (isGlobalPreset && auth.role !== 'superadmin') {
      return NextResponse.json(
        { error: 'Глобальные пресеты редактируются только суперадмином' },
        { status: 403 }
      )
    }
    if (!isGlobalPreset && existing.tenant_id !== auth.tenantId && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Пресет не найден' }, { status: 404 })
    }

    // 3) Собираем patch из присутствующих полей.
    const patch: Record<string, unknown> = {}

    if (body.display_name !== undefined) {
      const name = String(body.display_name).trim()
      if (!name) {
        return NextResponse.json({ error: 'Название не может быть пустым' }, { status: 400 })
      }
      patch.display_name = name
    }

    if (body.print_type !== undefined) {
      const pt = String(body.print_type)
      if (pt !== 'layflat' && pt !== 'soft') {
        return NextResponse.json(
          { error: 'Тип печати должен быть layflat или soft' },
          { status: 400 }
        )
      }
      patch.print_type = pt
      // sheet_type выводим из print_type (тот же контракт что в _create).
      patch.sheet_type = pt === 'layflat' ? 'hard' : 'soft'
    }

    // min/max — обрабатываем вместе, потому что они должны быть валидны
    // относительно друг друга (после применения патча).
    const newMin =
      body.min_pages !== undefined ? Number(body.min_pages) : existing.min_pages
    const newMax =
      body.max_pages !== undefined ? Number(body.max_pages) : existing.max_pages
    if (body.min_pages !== undefined || body.max_pages !== undefined) {
      if (body.min_pages !== undefined) {
        if (!Number.isFinite(newMin) || newMin < 1 || newMin > 200) {
          return NextResponse.json(
            { error: 'Минимум страниц от 1 до 200' },
            { status: 400 }
          )
        }
        patch.min_pages = newMin
      }
      if (body.max_pages !== undefined) {
        if (!Number.isFinite(newMax) || newMax < 1 || newMax > 200) {
          return NextResponse.json(
            { error: 'Максимум страниц от 1 до 200' },
            { status: 400 }
          )
        }
        patch.max_pages = newMax
      }
      // Cross-валидация только если оба значения известны
      // (newMin/newMax могут быть null если в БД и в body не задано —
      // тогда пропускаем, NULL семантически не нарушает порядок).
      if (
        typeof newMin === 'number' &&
        typeof newMax === 'number' &&
        Number.isFinite(newMin) &&
        Number.isFinite(newMax) &&
        newMin > newMax
      ) {
        return NextResponse.json(
          { error: 'Минимум страниц не может быть больше максимума' },
          { status: 400 }
        )
      }
    }

    if (body.template_set_id !== undefined) {
      // null или '' = сбросить на фолбэк okeybook-default.
      if (body.template_set_id === null || body.template_set_id === '') {
        patch.template_set_id = null
      } else {
        const tsid = String(body.template_set_id)
        if (tsid.length < 32) {
          return NextResponse.json(
            { error: 'template_set_id должен быть uuid' },
            { status: 400 }
          )
        }
        const { data: tsRow, error: tsErr } = await supabaseAdmin
          .from('template_sets')
          .select('id, tenant_id, is_global')
          .eq('id', tsid)
          .maybeSingle()
        if (tsErr) {
          return NextResponse.json({ error: tsErr.message }, { status: 500 })
        }
        if (!tsRow) {
          return NextResponse.json({ error: 'Дизайн не найден' }, { status: 400 })
        }
        const accessible =
          tsRow.is_global === true ||
          tsRow.tenant_id === null ||
          tsRow.tenant_id === auth.tenantId
        if (!accessible) {
          return NextResponse.json({ error: 'Этот дизайн недоступен' }, { status: 403 })
        }
        patch.template_set_id = tsid
      }
    }

    // РЭ.21.7.3: section_structure (опциональный).
    if (body.section_structure !== undefined) {
      const v = validateSectionStructure(body.section_structure)
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 })
      }
      patch.section_structure = v.value
    }

    // РЭ.21.7.5.1: density (опциональный). Через undefined-чек поддерживаем
    // явный сброс в null (когда партнёр выбрал "По умолчанию" в dropdown'е).
    if (body.density !== undefined) {
      const v = validateDensity(body.density)
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 })
      }
      patch.density = v.value
    }

    // РЭ.21.8.15: sheet_type (hard/soft) — теперь отдельное поле.
    // Партнёр может явно переключить пресет на мягкие/плотные листы.
    if (body.sheet_type !== undefined) {
      if (body.sheet_type === null) {
        patch.sheet_type = null
      } else {
        const st = String(body.sheet_type)
        if (st !== 'hard' && st !== 'soft') {
          return NextResponse.json(
            { error: 'sheet_type должен быть hard или soft' },
            { status: 400 }
          )
        }
        patch.sheet_type = st
      }
    }

    // РЭ.21.8.15: семантический описание макета личного раздела.
    // Все 3 поля nullable — null значит «семантический поиск не активен,
    // engine использует жёсткие имена по density / preset.id».
    if (body.student_pages_per_student !== undefined) {
      if (body.student_pages_per_student === null) {
        patch.student_pages_per_student = null
      } else {
        const n = Number(body.student_pages_per_student)
        if (n !== 1 && n !== 2) {
          return NextResponse.json(
            { error: 'student_pages_per_student должен быть 1 или 2 (или null)' },
            { status: 400 }
          )
        }
        patch.student_pages_per_student = n
      }
    }

    if (body.student_friend_photos !== undefined) {
      if (body.student_friend_photos === null) {
        patch.student_friend_photos = null
      } else {
        const n = Number(body.student_friend_photos)
        if (!Number.isInteger(n) || n < 0 || n > 10) {
          return NextResponse.json(
            { error: 'student_friend_photos должен быть целым 0..10 (или null)' },
            { status: 400 }
          )
        }
        patch.student_friend_photos = n
      }
    }

    if (body.student_has_quote !== undefined) {
      if (body.student_has_quote === null) {
        patch.student_has_quote = null
      } else if (typeof body.student_has_quote === 'boolean') {
        patch.student_has_quote = body.student_has_quote
      } else {
        return NextResponse.json(
          { error: 'student_has_quote должен быть boolean (или null)' },
          { status: 400 }
        )
      }
    }

    // РЭ.22.2: двух-осевая модель личного раздела (см. docs/phase-Р22-spec.md §4).
    // student_layout_mode — один из 'page'/'spread'/'grid' или null.
    // null = семантика не активна, engine идёт по legacy-пути.
    if (body.student_layout_mode !== undefined) {
      if (body.student_layout_mode === null) {
        patch.student_layout_mode = null
      } else if (
        typeof body.student_layout_mode === 'string' &&
        (body.student_layout_mode === 'page' ||
          body.student_layout_mode === 'spread' ||
          body.student_layout_mode === 'grid')
      ) {
        patch.student_layout_mode = body.student_layout_mode
      } else {
        return NextResponse.json(
          { error: "student_layout_mode должен быть 'page' / 'spread' / 'grid' (или null)" },
          { status: 400 }
        )
      }
    }

    // student_grid_size — целое 2..12 или null. Применимо только для
    // mode='grid', но cross-field валидацию здесь не делаем (это recommend,
    // не hard error — см. spec §4). UI РЭ.22.3 пишет null когда режим не grid.
    if (body.student_grid_size !== undefined) {
      if (body.student_grid_size === null) {
        patch.student_grid_size = null
      } else {
        const n = Number(body.student_grid_size)
        if (!Number.isInteger(n) || n < 2 || n > 12) {
          return NextResponse.json(
            { error: 'student_grid_size должен быть целым 2..12 (или null)' },
            { status: 400 }
          )
        }
        patch.student_grid_size = n
      }
    }

    // РЭ.37.1: симметризация хвоста students-секции (boolean).
    // Engine применяет только для комплектаций Мини/Лайт (см. РЭ.37.4),
    // но валидация на уровне API проста — это просто boolean. Cross-field
    // согласованность с layout_mode/grid_size — забота UI РЭ.37.5
    // (галочка скрыта/disabled когда комплектация не Мини/Лайт).
    if (body.symmetrize_students_tail !== undefined) {
      if (typeof body.symmetrize_students_tail !== 'boolean') {
        return NextResponse.json(
          { error: 'symmetrize_students_tail должен быть boolean' },
          { status: 400 },
        )
      }
      patch.symmetrize_students_tail = body.symmetrize_students_tail
    }

    // РЭ.37.6: ручной сценарий transition-разворота (jsonb).
    //
    // Принимаемые формы:
    //   null                          → сбросить на OkeyBook-default
    //   { mode: 'default' }           → то же что null, но явно
    //   { mode: 'custom',
    //     tail_left_master_id:  string|null,
    //     tail_right_master_id: string|null,
    //     closing_master_id:    string|null  // резерв, пока игнорируется
    //                                           engine'ом
    //   }
    //
    // В custom-режиме хотя бы один из *_master_id должен быть не null
    // (см. CHECK constraint presets_transition_scenario_valid в миграции
    // 2026-05-24-presets-transition-scenario.sql). API повторяет эту
    // проверку чтобы дать осмысленный 400 ответ вместо сырой ошибки БД.
    //
    // Сами master_id мы FK-проверкой НЕ валидируем — мастера могут быть
    // удалены из template_set независимо. Если на момент сборки альбома
    // master_id отсутствует — engine добавит warning
    // transition_custom_master_not_found (см. РЭ.37.6.c).
    if (body.transition_scenario !== undefined) {
      const ts = body.transition_scenario
      if (ts === null) {
        patch.transition_scenario = null
      } else if (typeof ts !== 'object' || Array.isArray(ts)) {
        return NextResponse.json(
          { error: 'transition_scenario должен быть object или null' },
          { status: 400 },
        )
      } else {
        const mode = (ts as { mode?: unknown }).mode
        if (mode !== 'default' && mode !== 'custom') {
          return NextResponse.json(
            { error: "transition_scenario.mode должен быть 'default' или 'custom'" },
            { status: 400 },
          )
        }
        if (mode === 'default') {
          // Нормализуем default → null (упрощает чтение в engine'е, NULL
          // и default равнозначны).
          patch.transition_scenario = null
        } else {
          // custom: проверяем что хотя бы один master_id задан и валиден
          // (string или null). Остальные поля игнорируются.
          const obj = ts as Record<string, unknown>
          const fields = ['tail_left_master_id', 'tail_right_master_id', 'closing_master_id']
          for (const field of fields) {
            const v = obj[field]
            if (v !== undefined && v !== null && typeof v !== 'string') {
              return NextResponse.json(
                { error: `transition_scenario.${field} должен быть string или null` },
                { status: 400 },
              )
            }
          }
          const allNull = fields.every((f) => obj[f] === undefined || obj[f] === null)
          if (allNull) {
            return NextResponse.json(
              {
                error:
                  "transition_scenario с mode='custom' должен задавать хотя бы один master_id " +
                  '(tail_left_master_id / tail_right_master_id / closing_master_id)',
              },
              { status: 400 },
            )
          }
          patch.transition_scenario = {
            mode: 'custom',
            tail_left_master_id: (obj.tail_left_master_id as string | null | undefined) ?? null,
            tail_right_master_id: (obj.tail_right_master_id as string | null | undefined) ?? null,
            closing_master_id: (obj.closing_master_id as string | null | undefined) ?? null,
          }
        }
      }
    }

    // РЭ.24.7: галка «рекомендовать в каталоге партнёров».
    // Только глобальные пресеты могут быть recommended — для тенантских
    // это поле не используется в API templates_list_global. Если приходит
    // is_recommended=true для тенантского пресета — это пользовательская
    // ошибка, отвечаем 400 чтобы избежать молчаливого ничего-не-делания.
    if (body.is_recommended !== undefined) {
      if (typeof body.is_recommended !== 'boolean') {
        return NextResponse.json(
          { error: 'is_recommended должен быть boolean' },
          { status: 400 },
        )
      }
      if (body.is_recommended === true && !isGlobalPreset) {
        return NextResponse.json(
          { error: 'Рекомендовать можно только глобальные пресеты' },
          { status: 400 },
        )
      }
      patch.is_recommended = body.is_recommended
    }

    // 4) Если ничего не пришло — отвечаем ok без UPDATE'а
    // (избегаем лишнего round-trip к БД).
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, preset: { id: presetId }, updated: false })
    }

    // 5) UPDATE с фильтром по id. Для не-superadmin'а добавляем фильтр
    // по tenant_id (защита от гонки если за это время кто-то сменил
    // владельца). Superadmin может править любой пресет.
    let updateQuery = supabaseAdmin
      .from('presets')
      .update(patch)
      .eq('id', presetId)
    if (auth.role !== 'superadmin') {
      updateQuery = updateQuery.eq('tenant_id', auth.tenantId)
    }
    const { data: updated, error: updateErr } = await updateQuery
      .select('id, display_name')
      .single()
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, preset: updated, updated: true })
  }

  // ----------------------------------------------------------
  // template_set_update_display_label (РЭ.23.3) — обновление
  // человеко-читаемого названия мастера для каталога /super/master-catalog.
  //
  // Body: { template_id: string (uuid), display_label: string | null }
  // Доступ только админам/суперадминам.
  // Tenant-aware: чужие глобальные template_set'ы (tenant_id=NULL) —
  // только superadmin; чужие тенант'овские → 404.
  // ----------------------------------------------------------
  if (body.action === 'template_set_update_display_label') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }

    const templateId = String(body.template_id ?? '').trim()
    if (!templateId) {
      return NextResponse.json(
        { error: 'template_id обязателен' },
        { status: 400 },
      )
    }

    // display_label: null допустим (UI fallback на name); иначе trimmed строка.
    let displayLabel: string | null
    if (body.display_label === null || body.display_label === undefined) {
      displayLabel = null
    } else {
      const trimmed = String(body.display_label).trim()
      displayLabel = trimmed === '' ? null : trimmed
    }

    // 1) Загружаем мастер чтобы узнать его template_set_id.
    const { data: master, error: loadErr } = await supabaseAdmin
      .from('spread_templates')
      .select('id, template_set_id')
      .eq('id', templateId)
      .maybeSingle()
    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }
    if (!master) {
      return NextResponse.json({ error: 'Мастер не найден' }, { status: 404 })
    }

    // 2) Проверка владения через template_set.
    const { data: ts, error: tsErr } = await supabaseAdmin
      .from('template_sets')
      .select('id, tenant_id')
      .eq('id', master.template_set_id)
      .maybeSingle()
    if (tsErr) {
      return NextResponse.json({ error: tsErr.message }, { status: 500 })
    }
    if (!ts) {
      return NextResponse.json({ error: 'Мастер не найден' }, { status: 404 })
    }
    const isGlobal = ts.tenant_id === null
    if (isGlobal && auth.role !== 'superadmin') {
      return NextResponse.json(
        { error: 'Глобальные мастера редактируются только суперадмином' },
        { status: 403 },
      )
    }
    if (!isGlobal && ts.tenant_id !== auth.tenantId && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Мастер не найден' }, { status: 404 })
    }

    // 3) Обновление.
    const { error: updErr } = await supabaseAdmin
      .from('spread_templates')
      .update({ display_label: displayLabel })
      .eq('id', templateId)
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      master: { id: templateId, display_label: displayLabel },
    })
  }

  // ----------------------------------------------------------
  // template_clone (РЭ.24.4) — клонирование глобального шаблона
  // в личную библиотеку партнёра.
  //
  // Body: { template_id: string, display_name?: string }
  //
  // Шаги:
  //   1. SELECT preset WHERE id=template_id AND tenant_id IS NULL.
  //      Если не найден или это партнёрский — 404.
  //   2. INSERT копия с tenant_id=auth.tenantId, parent_preset_id=
  //      template_id, новым id, is_recommended=false. Все остальные
  //      поля копируются как есть.
  //   3. Возврат: { id, display_name }.
  //
  // Доступ: не-viewer (admin/owner/photographer/superadmin).
  // ----------------------------------------------------------
  if (body.action === 'template_clone') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
    if (!auth.tenantId) {
      return NextResponse.json({ error: 'Не задан tenant' }, { status: 400 })
    }

    const sourceId = String(body.template_id ?? '').trim()
    if (!sourceId) {
      return NextResponse.json(
        { error: 'template_id обязателен' },
        { status: 400 },
      )
    }

    // Загружаем оригинал.
    const { data: source, error: loadErr } = await supabaseAdmin
      .from('presets')
      .select('*')
      .eq('id', sourceId)
      .maybeSingle()
    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }
    if (!source) {
      return NextResponse.json({ error: 'Шаблон не найден' }, { status: 404 })
    }
    if (source.tenant_id !== null) {
      // Клонировать можно только глобальные.
      return NextResponse.json(
        { error: 'Клонировать можно только глобальные шаблоны' },
        { status: 403 },
      )
    }

    // Имя клона.
    const customName = body.display_name
      ? String(body.display_name).trim()
      : null
    const newDisplayName = customName || `${source.display_name} (копия)`

    // Новый id.
    const randomSuffix = Math.random().toString(36).slice(2, 10)
    const newId = `clone-${randomSuffix}`

    // Копируем все поля кроме id, tenant_id, parent_preset_id,
    // is_recommended, display_name, created_at.
    const newRow: any = {
      ...source,
      id: newId,
      tenant_id: auth.tenantId,
      parent_preset_id: source.id,
      is_recommended: false, // только глобальные рекомендованные
      display_name: newDisplayName,
    }
    // Удаляем поля которые БД проставит сама.
    delete newRow.created_at
    delete newRow.updated_at

    const { data: created, error: insErr } = await supabaseAdmin
      .from('presets')
      .insert(newRow)
      .select('id, display_name')
      .single()
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, template: created })
  }

  // ----------------------------------------------------------
  // template_create_blank (РЭ.24.4 / расширено в РЭ.24.5b) —
  // пустой шаблон с нуля.
  //
  // Body: { display_name: string, template_set_id?: string }
  //
  // Создаёт минимальный шаблон с tenant_id=auth.tenantId.
  // РЭ.24.5b: если передан template_set_id — шаблон сразу привязан
  // к конкретному дизайну (партнёр создаёт шаблон находясь в дизайне).
  // Если не передан — оставляем NULL, шаблон будет невалиден до тех
  // пор пока партнёр не выберет дизайн в редакторе.
  //
  // Если передан template_set_id — проверяем что он доступен партнёру
  // (глобальный или его собственный) — нельзя создать шаблон ссылкой
  // на чужой template_set.
  //
  // На этапе создания шаблон невалиден (section_structure пустой,
  // student_layout_mode=null), что нормально — UI пометит «Доработай»
  // и партнёр доработает через PresetEditorModal.
  //
  // Доступ: не-viewer.
  // ----------------------------------------------------------
  if (body.action === 'template_create_blank') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
    if (!auth.tenantId) {
      return NextResponse.json({ error: 'Не задан tenant' }, { status: 400 })
    }

    const displayName = String(body.display_name ?? '').trim()
    if (!displayName) {
      return NextResponse.json(
        { error: 'Название шаблона обязательно' },
        { status: 400 },
      )
    }

    // Опциональный template_set_id — валидируем доступ.
    let templateSetId: string | null = null
    if (body.template_set_id) {
      const tsid = String(body.template_set_id).trim()
      const { data: ts, error: tsErr } = await supabaseAdmin
        .from('template_sets')
        .select('id, tenant_id')
        .eq('id', tsid)
        .maybeSingle()
      if (tsErr) {
        return NextResponse.json({ error: tsErr.message }, { status: 500 })
      }
      if (!ts) {
        return NextResponse.json(
          { error: 'Дизайн не найден' },
          { status: 400 },
        )
      }
      const accessible =
        ts.tenant_id === null ||
        ts.tenant_id === auth.tenantId ||
        auth.role === 'superadmin'
      if (!accessible) {
        return NextResponse.json(
          { error: 'Этот дизайн недоступен' },
          { status: 403 },
        )
      }
      templateSetId = tsid
    }

    const randomSuffix = Math.random().toString(36).slice(2, 10)
    const newId = `blank-${randomSuffix}`

    const { data: created, error: insErr } = await supabaseAdmin
      .from('presets')
      .insert({
        id: newId,
        display_name: displayName,
        print_type: 'layflat',
        pages_per_spread: 2,
        version: '1.0',
        sections: [],
        section_structure: [],
        template_set_id: templateSetId,
        tenant_id: auth.tenantId,
        parent_preset_id: null,
        is_recommended: false,
        sheet_type: 'hard',
      })
      .select('id, display_name')
      .single()
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, template: created })
  }

  // ----------------------------------------------------------
  // template_delete (РЭ.24.4) — удаление шаблона партнёра.
  //
  // Body: { template_id: string }
  //
  // Шаги:
  //   1. SELECT preset → 404 если не найден или не свой.
  //   2. SELECT COUNT(*) FROM albums WHERE preset_id=template_id
  //      AND archived=false. Если > 0 → 409 со списком альбомов.
  //   3. DELETE FROM presets.
  //
  // Доступ: admin/owner/superadmin (photographer тоже может).
  // ----------------------------------------------------------
  if (body.action === 'template_delete') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
    if (!auth.tenantId) {
      return NextResponse.json({ error: 'Не задан tenant' }, { status: 400 })
    }

    const templateId = String(body.template_id ?? '').trim()
    if (!templateId) {
      return NextResponse.json(
        { error: 'template_id обязателен' },
        { status: 400 },
      )
    }

    // Загружаем шаблон.
    const { data: preset, error: loadErr } = await supabaseAdmin
      .from('presets')
      .select('id, tenant_id, display_name')
      .eq('id', templateId)
      .maybeSingle()
    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }
    if (!preset) {
      return NextResponse.json({ error: 'Шаблон не найден' }, { status: 404 })
    }
    // Глобальный — нельзя удалить через этот endpoint даже superadmin.
    if (preset.tenant_id === null) {
      return NextResponse.json(
        { error: 'Глобальные шаблоны не удаляются через эту операцию' },
        { status: 403 },
      )
    }
    // Чужой тенант — 404.
    if (preset.tenant_id !== auth.tenantId && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Шаблон не найден' }, { status: 404 })
    }

    // Проверка активных альбомов.
    const { data: albums, error: albumsErr } = await supabaseAdmin
      .from('albums')
      .select('id, title, archived')
      .eq('preset_id', templateId)
      .eq('archived', false)
    if (albumsErr) {
      return NextResponse.json({ error: albumsErr.message }, { status: 500 })
    }
    if ((albums?.length ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Шаблон используется в ${albums!.length} альбомах. Сначала переключите альбомы на другой шаблон или архивируйте их.`,
          albums: albums!.map((a) => ({ id: a.id, title: a.title })),
        },
        { status: 409 },
      )
    }

    // Удаляем.
    const { error: delErr } = await supabaseAdmin
      .from('presets')
      .delete()
      .eq('id', templateId)
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // РЭ.28.3: template_set_clone — клонирование глобального
  // template_set'а с изменением размеров под партнёрскую типографию.
  //
  // Body: {
  //   source_template_set_id: string (uuid),
  //   new_name: string,
  //   new_page_width_mm: number,
  //   new_page_height_mm: number,
  //   new_bleed_mm?: number | null,
  // }
  //
  // Логика (см. docs/phase-Р28-spec.md §4.1):
  // 1) Загружаем source template_set + связанные spread_templates.
  // 2) Проверяем доступ: source должен быть глобальным
  //    (tenant_id IS NULL) либо принадлежать партнёру.
  // 3) prepareTemplateSetClone(...) — чистая функция из РЭ.28.2,
  //    делает всю валидацию и подготовку ClonePlan.
  // 4) Если plan.resize_info.aspect_check.level === 'blocked' —
  //    функция throw, ловим и отдаём 400 партнёру.
  // 5) INSERT template_sets → новый id.
  // 6) INSERT spread_templates (все мастера, batched).
  //    Если шаг 6 упал — ручной rollback (DELETE template_set),
  //    так как Supabase JS client не поддерживает явные транзакции.
  // 7) Audit log + response.
  //
  // Доступ: не-viewer (партнёр сам клонирует свои дизайны).
  // ----------------------------------------------------------
  if (body.action === 'template_set_clone') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
    if (!auth.tenantId) {
      return NextResponse.json({ error: 'Не задан tenant' }, { status: 400 })
    }

    const sourceId = String(body.source_template_set_id ?? '').trim()
    const newName = String(body.new_name ?? '').trim()
    const newW = Number(body.new_page_width_mm)
    const newH = Number(body.new_page_height_mm)
    const newBleedRaw = body.new_bleed_mm

    if (!sourceId) {
      return NextResponse.json(
        { error: 'source_template_set_id обязателен' },
        { status: 400 },
      )
    }
    if (!newName) {
      return NextResponse.json(
        { error: 'new_name обязателен' },
        { status: 400 },
      )
    }
    if (!Number.isFinite(newW) || newW < 50 || newW > 500) {
      return NextResponse.json(
        { error: 'new_page_width_mm должен быть числом 50-500' },
        { status: 400 },
      )
    }
    if (!Number.isFinite(newH) || newH < 50 || newH > 500) {
      return NextResponse.json(
        { error: 'new_page_height_mm должен быть числом 50-500' },
        { status: 400 },
      )
    }
    // new_bleed_mm: undefined / null / число 0-20
    let newBleed: number | null | undefined
    if (newBleedRaw === undefined) {
      newBleed = undefined
    } else if (newBleedRaw === null) {
      newBleed = null
    } else {
      const b = Number(newBleedRaw)
      if (!Number.isFinite(b) || b < 0 || b > 20) {
        return NextResponse.json(
          { error: 'new_bleed_mm должен быть числом 0-20 или null' },
          { status: 400 },
        )
      }
      newBleed = b
    }

    // 1) Загружаем source template_set.
    const { data: source, error: srcErr } = await supabaseAdmin
      .from('template_sets')
      .select('*')
      .eq('id', sourceId)
      .maybeSingle()
    if (srcErr) {
      return NextResponse.json({ error: srcErr.message }, { status: 500 })
    }
    if (!source) {
      return NextResponse.json({ error: 'Дизайн не найден' }, { status: 404 })
    }

    // 2) Проверка доступа.
    const sourceTenantId = (source as { tenant_id: string | null }).tenant_id
    if (sourceTenantId !== null && sourceTenantId !== auth.tenantId) {
      return NextResponse.json(
        { error: 'Можно клонировать только глобальные или свои дизайны' },
        { status: 403 },
      )
    }

    // Загружаем все spread_templates исходника.
    const { data: sourceMasters, error: mastersErr } = await supabaseAdmin
      .from('spread_templates')
      .select('*')
      .eq('template_set_id', sourceId)
    if (mastersErr) {
      return NextResponse.json({ error: mastersErr.message }, { status: 500 })
    }

    // 3) prepareTemplateSetClone — все валидации внутри.
    let plan
    try {
      plan = prepareTemplateSetClone({
        source_template_set: {
          id: (source as { id: string }).id,
          name: (source as { name: string }).name,
          page_width_mm: Number((source as { page_width_mm: number }).page_width_mm),
          page_height_mm: Number((source as { page_height_mm: number }).page_height_mm),
          spread_width_mm: Number((source as { spread_width_mm: number }).spread_width_mm),
          spread_height_mm: Number((source as { spread_height_mm: number }).spread_height_mm),
          bleed_mm: (source as { bleed_mm: number | null }).bleed_mm,
          print_type: (source as { print_type: string }).print_type,
          facing_pages: (source as { facing_pages: boolean | null }).facing_pages,
          page_binding: (source as { page_binding: string | null }).page_binding,
          description: (source as { description: string | null }).description,
        },
        source_masters: (sourceMasters ?? []) as Parameters<typeof prepareTemplateSetClone>[0]['source_masters'],
        new_name: newName,
        new_page_width_mm: newW,
        new_page_height_mm: newH,
        new_bleed_mm: newBleed,
      })
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 400 },
      )
    }

    // 5) INSERT нового template_set.
    const newTsRow = {
      ...plan.new_template_set,
      tenant_id: auth.tenantId,
    }
    const { data: createdTs, error: insTsErr } = await supabaseAdmin
      .from('template_sets')
      .insert(newTsRow)
      .select('id')
      .single()
    if (insTsErr || !createdTs) {
      return NextResponse.json(
        { error: insTsErr?.message ?? 'Не удалось создать template_set' },
        { status: 500 },
      )
    }
    const newTsId = (createdTs as { id: string }).id

    // 6) INSERT spread_templates. Если упадёт — rollback (DELETE template_set).
    if (plan.new_masters.length > 0) {
      // Чистим служебные поля от source (id, template_set_id, created_at)
      // и проставляем новый template_set_id.
      const mastersToInsert = plan.new_masters.map((m) => {
        const cleaned: Record<string, unknown> = { ...m }
        delete cleaned.id
        delete cleaned.template_set_id
        delete cleaned.created_at
        cleaned.template_set_id = newTsId
        return cleaned
      })

      const { error: insMastersErr } = await supabaseAdmin
        .from('spread_templates')
        .insert(mastersToInsert)
      if (insMastersErr) {
        // Ручной rollback — удаляем созданный template_set.
        await supabaseAdmin.from('template_sets').delete().eq('id', newTsId)
        return NextResponse.json(
          {
            error:
              'Не удалось вставить мастера, изменения отменены: ' +
              insMastersErr.message,
          },
          { status: 500 },
        )
      }
    }

    // 7) Audit log.
    try {
      await logAction(auth, 'template_set.clone', 'template_set', newTsId, {
        source_template_set_id: sourceId,
        new_name: newName,
        new_page_width_mm: newW,
        new_page_height_mm: newH,
        scale_x: plan.resize_info.scale_x,
        scale_y: plan.resize_info.scale_y,
        aspect_level: plan.resize_info.aspect_check.level,
        aspect_diff_percent: plan.resize_info.aspect_check.aspect_diff_percent,
        masters_count: plan.resize_info.masters_count,
        placeholders_resized: plan.resize_info.placeholders_resized,
      })
    } catch (e) {
      // Audit лог не должен ломать главный flow.
      console.warn('[template_set_clone] audit log failed:', e)
    }

    return NextResponse.json({
      ok: true,
      template_set_id: newTsId,
      aspect_check: plan.resize_info.aspect_check,
      masters_count: plan.resize_info.masters_count,
    })
  }

  // ----------------------------------------------------------
  // РЭ.28.3: template_set_delete — удаление партнёрского клона.
  //
  // Body: { template_set_id: string }
  //
  // Защита:
  // - Только tenant_id === auth.tenantId (партнёр свой удаляет).
  // - Глобальные (tenant_id IS NULL) НИКОГДА не удаляются.
  // - COUNT ссылок из albums.template_set_id + presets.template_set_id.
  //   Если ≥ 1 → 409 + сообщение «используется в N альбомах и M пресетах».
  //
  // Доступ: не-viewer.
  // ----------------------------------------------------------
  if (body.action === 'template_set_delete') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }
    if (!auth.tenantId) {
      return NextResponse.json({ error: 'Не задан tenant' }, { status: 400 })
    }

    const tsId = String(body.template_set_id ?? '').trim()
    if (!tsId) {
      return NextResponse.json(
        { error: 'template_set_id обязателен' },
        { status: 400 },
      )
    }

    // Загружаем template_set.
    const { data: ts, error: loadErr } = await supabaseAdmin
      .from('template_sets')
      .select('id, tenant_id, name')
      .eq('id', tsId)
      .maybeSingle()
    if (loadErr) {
      return NextResponse.json({ error: loadErr.message }, { status: 500 })
    }
    if (!ts) {
      return NextResponse.json({ error: 'Дизайн не найден' }, { status: 404 })
    }
    const tsTenantId = (ts as { tenant_id: string | null }).tenant_id
    // Глобальный — нельзя удалить никогда через этот endpoint.
    if (tsTenantId === null) {
      return NextResponse.json(
        { error: 'Глобальные дизайны не удаляются' },
        { status: 403 },
      )
    }
    // Чужой тенант — 404.
    if (tsTenantId !== auth.tenantId && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Дизайн не найден' }, { status: 404 })
    }

    // Проверка ссылок из albums.
    const { count: albumsCount, error: albumsErr } = await supabaseAdmin
      .from('albums')
      .select('id', { count: 'exact', head: true })
      .eq('template_set_id', tsId)
    if (albumsErr) {
      return NextResponse.json({ error: albumsErr.message }, { status: 500 })
    }
    // Проверка ссылок из presets.
    const { count: presetsCount, error: presetsErr } = await supabaseAdmin
      .from('presets')
      .select('id', { count: 'exact', head: true })
      .eq('template_set_id', tsId)
    if (presetsErr) {
      return NextResponse.json({ error: presetsErr.message }, { status: 500 })
    }

    const ac = albumsCount ?? 0
    const pc = presetsCount ?? 0
    if (ac > 0 || pc > 0) {
      const parts: string[] = []
      if (ac > 0) parts.push(`${ac} альбомах`)
      if (pc > 0) parts.push(`${pc} пресетах`)
      return NextResponse.json(
        {
          error: `Дизайн используется в ${parts.join(' и ')}. Сначала переключите их на другой дизайн.`,
          albums_count: ac,
          presets_count: pc,
        },
        { status: 409 },
      )
    }

    // Удаляем сначала мастера (нет ON DELETE CASCADE).
    const { error: delMastersErr } = await supabaseAdmin
      .from('spread_templates')
      .delete()
      .eq('template_set_id', tsId)
    if (delMastersErr) {
      return NextResponse.json(
        { error: 'Не удалось удалить мастера: ' + delMastersErr.message },
        { status: 500 },
      )
    }

    // Удаляем template_set.
    const { error: delTsErr } = await supabaseAdmin
      .from('template_sets')
      .delete()
      .eq('id', tsId)
    if (delTsErr) {
      return NextResponse.json({ error: delTsErr.message }, { status: 500 })
    }

    // Audit log.
    try {
      await logAction(auth, 'template_set.delete', 'template_set', tsId, {
        name: (ts as { name: string }).name,
      })
    } catch (e) {
      console.warn('[template_set_delete] audit log failed:', e)
    }

    return NextResponse.json({ ok: true })
  }

  if (body.action === 'create_album') {
    // Проверяем лимит по тарифу
    if (auth.role !== 'superadmin') {
      const [{ count: currentCount }, { data: tenant }] = await Promise.all([
        supabaseAdmin
          .from('albums')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenantId)
          .eq('archived', false),
        supabaseAdmin
          .from('tenants')
          .select('max_albums, is_active, plan_expires')
          .eq('id', auth.tenantId)
          .single(),
      ])

      if (!tenant?.is_active) {
        return NextResponse.json(
          { error: 'Аккаунт заблокирован. Обратитесь в поддержку.' },
          { status: 403 }
        )
      }

      if (tenant.plan_expires && new Date(tenant.plan_expires) < new Date()) {
        return NextResponse.json(
          { error: 'Срок действия тарифа истёк. Обратитесь в поддержку.' },
          { status: 403 }
        )
      }

      if ((currentCount ?? 0) >= tenant.max_albums) {
        return NextResponse.json(
          {
            error: `Достигнут лимит тарифа: ${tenant.max_albums} активных альбомов. Архивируйте ненужные или обновите тариф.`,
          },
          { status: 403 }
        )
      }
    }

    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'Название обязательно' }, { status: 400 })
    }

    // Резолв preset_slug → config_preset_id + print_type (фаза 0.5.6.1)
    let configPresetId: string | null = null
    let presetPrintType: string | null = null
    if (typeof body.preset_slug === 'string' && body.preset_slug.length > 0) {
      const preset = await resolvePresetBySlug(body.preset_slug)
      if (!preset) {
        return NextResponse.json(
          { error: `preset_slug ${body.preset_slug} not found` },
          { status: 400 },
        )
      }
      configPresetId = preset.id
      presetPrintType = preset.print_type
    }

    // РЭ.24.6: если передан section_structure_preset_id — это новый
    // путь через каталог /app/templates. Берём template_set_id и
    // print_type из preset'а. Legacy preset_slug игнорируется (если
    // вдруг пришёл одновременно). Валидируем что preset существует
    // и доступен партнёру (свой или глобальный).
    let sectionStructurePresetId: string | null = null
    let resolvedTemplateSetId: string | null = null
    if (typeof body.section_structure_preset_id === 'string' && body.section_structure_preset_id.length > 0) {
      const { data: ps, error: psErr } = await supabaseAdmin
        .from('presets')
        .select('id, tenant_id, template_set_id, print_type')
        .eq('id', body.section_structure_preset_id)
        .maybeSingle()
      if (psErr) {
        return NextResponse.json({ error: psErr.message }, { status: 500 })
      }
      if (!ps) {
        return NextResponse.json(
          { error: 'Шаблон не найден' },
          { status: 400 },
        )
      }
      const accessible =
        ps.tenant_id === null ||
        ps.tenant_id === auth.tenantId ||
        auth.role === 'superadmin'
      if (!accessible) {
        return NextResponse.json(
          { error: 'Шаблон недоступен' },
          { status: 403 },
        )
      }
      sectionStructurePresetId = ps.id
      resolvedTemplateSetId = ps.template_set_id ?? null
      presetPrintType = ps.print_type ?? presetPrintType
      // Когда выбран новый шаблон — legacy config_preset_id очищаем.
      configPresetId = null
    }

    // template_set_id: приоритет — из section_structure preset'а;
    // fallback — единственный okeybook-default (для legacy/безпресетных).
    const templateSetId = resolvedTemplateSetId ?? (await getDefaultTemplateSetId())

    // РЭ.27.2: print_type определяется в порядке приоритета:
    //   1. body.print_type явно передан и валиден → используем его (партнёр
    //      может создать альбом с типом листов, отличным от пресета).
    //   2. иначе → presetPrintType (текущее поведение, копирование из пресета).
    //   3. иначе → null (engine применит resolvePrintType с fallback на пресет,
    //      см. подэтап 27.3).
    let resolvedPrintType: string | null = presetPrintType
    if (body.print_type !== undefined && body.print_type !== null) {
      const pt = String(body.print_type)
      if (pt !== 'layflat' && pt !== 'soft') {
        return NextResponse.json(
          { error: `print_type должен быть 'layflat' или 'soft', получено: ${pt}` },
          { status: 400 },
        )
      }
      resolvedPrintType = pt
    }

    const { data, error } = await supabaseAdmin
      .from('albums')
      .insert({
        tenant_id: auth.tenantId,
        title: body.title.trim(),
        classes: body.classes ?? [],
        cover_mode: body.cover_mode ?? 'none',
        cover_price: body.cover_price ?? 0,
        deadline: body.deadline ?? null,
        group_enabled: body.group_enabled ?? true,
        group_min: body.group_min ?? 2,
        group_max: body.group_max ?? 2,
        group_exclusive: body.group_exclusive ?? true,
        personal_spread_enabled: body.personal_spread_enabled ?? false,
        personal_spread_price: body.personal_spread_price ?? 300,
        personal_spread_min: body.personal_spread_min ?? 4,
        personal_spread_max: body.personal_spread_max ?? 12,
        text_enabled: body.text_enabled ?? true,
        text_max_chars: body.text_max_chars ?? 500,
        text_type: body.text_type ?? 'free',
        template_title: body.template_title ?? null,
        city: body.city ?? null,
        year: body.year ?? new Date().getFullYear(),
        config_preset_id: configPresetId,
        template_set_id: templateSetId,
        print_type: resolvedPrintType,
        section_structure_preset_id: sectionStructurePresetId,
        // РЭ.25: переопределение фильтра не-заказчиков в личном разделе.
        // Default false (строгое поведение). Если фотограф хочет всем
        // ученикам персональную страницу — поднимает галку до true.
        include_non_purchasers:
          body.include_non_purchasers === true ? true : false,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.create', 'album', data.id, {
      title: data.title,
      city: data.city,
      template: data.template_title,
    })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // album_clone (РЭ.39) — клонирование альбома с переносом всех
  // заполненных данных (ученики, учителя, фото, выбор фото, тексты).
  //
  // Что копируется:
  //   • Сам album row (с теми же настройками + новый title с « — копия»)
  //   • children, teachers, responsible_parents — НОВЫЕ access_token'ы
  //     (БД генерирует их через DEFAULT при INSERT без указания поля)
  //   • photos, original_photos — метаданные (storage_path тот же:
  //     файлы на бакете immutable, новые rows ссылаются на те же blob'ы)
  //   • quotes (цитаты пресета), selections (выбор фото родителями),
  //     photo_children, photo_teachers (теги «кто на фото»),
  //     student_texts, parent_contacts (текст от родителей),
  //     cover_selections, quote_selections (выбор обложки и цитат),
  //     personal_spread_photos (личные развороты)
  //
  // Что НЕ копируется:
  //   • album_layouts — пересобирается с нуля при первой сборке копии
  //     (партнёр может сменить пресет, тогда layout будет другим)
  //   • invitations, photo_locks (временные/устаревающие токены)
  //   • album_exports, delivery_files (PDF-экспорты)
  //   • audit_log (история действий)
  //
  // Транзакционность: Supabase JS не поддерживает явные TX, поэтому при
  // частичной ошибке копия может остаться «полусделанной». Для безопасности
  // делаем шаги в порядке зависимостей и rollback'им новый album при
  // первой же ошибке на дочерних таблицах. Без race-conditions на тех же
  // данных — мы лишь читаем оригинал и пишем в копию (изолированы).
  // ----------------------------------------------------------
  if (body.action === 'album_clone') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
    }

    const sourceAlbumId = String(body.source_album_id ?? '').trim()
    if (!sourceAlbumId) {
      return NextResponse.json(
        { error: 'source_album_id обязателен' },
        { status: 400 },
      )
    }

    // Опциональный title для копии (если не задан — auto-suffix).
    const customTitle =
      typeof body.new_title === 'string' && body.new_title.trim()
        ? body.new_title.trim()
        : null

    // 1) Загружаем source album + проверяем доступ.
    const { data: sourceAlbum, error: srcErr } = await supabaseAdmin
      .from('albums')
      .select('*')
      .eq('id', sourceAlbumId)
      .maybeSingle()
    if (srcErr) {
      return NextResponse.json({ error: srcErr.message }, { status: 500 })
    }
    if (!sourceAlbum) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }
    if (
      auth.role !== 'superadmin' &&
      sourceAlbum.tenant_id !== auth.tenantId
    ) {
      return NextResponse.json(
        { error: 'Доступ запрещён: альбом другого партнёра' },
        { status: 403 },
      )
    }

    // 2) Проверка лимита тарифа (как в create_album).
    if (auth.role !== 'superadmin') {
      const [{ count: currentCount }, { data: tenant }] = await Promise.all([
        supabaseAdmin
          .from('albums')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenantId)
          .eq('archived', false),
        supabaseAdmin
          .from('tenants')
          .select('max_albums, is_active, plan_expires')
          .eq('id', auth.tenantId)
          .single(),
      ])

      if (!tenant?.is_active) {
        return NextResponse.json(
          { error: 'Аккаунт заблокирован. Обратитесь в поддержку.' },
          { status: 403 },
        )
      }
      if (tenant.plan_expires && new Date(tenant.plan_expires) < new Date()) {
        return NextResponse.json(
          { error: 'Срок действия тарифа истёк. Обратитесь в поддержку.' },
          { status: 403 },
        )
      }
      if ((currentCount ?? 0) >= tenant.max_albums) {
        return NextResponse.json(
          {
            error: `Достигнут лимит тарифа: ${tenant.max_albums} активных альбомов. Архивируйте ненужные или обновите тариф.`,
          },
          { status: 403 },
        )
      }
    }

    // 3) Создаём копию album row. Title с суффиксом « — копия» если
    // партнёр не задал свой.
    const newTitle = customTitle ?? `${sourceAlbum.title} — копия`
    // Берём ВСЕ настройки оригинала, кроме служебных. id, created_at —
    // пусть БД сама генерирует. archived=false — копия активна.
    // submitted_at / started_at и т.п. — НЕ копируем (это статусы, новая
    // копия начинает с чистого листа).
    const albumInsert: Record<string, unknown> = {
      tenant_id: auth.tenantId,
      title: newTitle,
      classes: sourceAlbum.classes ?? [],
      cover_mode: sourceAlbum.cover_mode ?? 'none',
      cover_price: sourceAlbum.cover_price ?? 0,
      deadline: sourceAlbum.deadline ?? null,
      group_enabled: sourceAlbum.group_enabled ?? true,
      group_min: sourceAlbum.group_min ?? 2,
      group_max: sourceAlbum.group_max ?? 2,
      group_exclusive: sourceAlbum.group_exclusive ?? true,
      personal_spread_enabled: sourceAlbum.personal_spread_enabled ?? false,
      personal_spread_price: sourceAlbum.personal_spread_price ?? 300,
      personal_spread_min: sourceAlbum.personal_spread_min ?? 4,
      personal_spread_max: sourceAlbum.personal_spread_max ?? 12,
      text_enabled: sourceAlbum.text_enabled ?? true,
      text_max_chars: sourceAlbum.text_max_chars ?? 500,
      text_type: sourceAlbum.text_type ?? 'free',
      template_title: sourceAlbum.template_title ?? null,
      city: sourceAlbum.city ?? null,
      year: sourceAlbum.year ?? new Date().getFullYear(),
      // По решению Сергея: настройки пресета/дизайна копируем как есть
      // (партнёр потом может сменить).
      config_preset_id: sourceAlbum.config_preset_id ?? null,
      template_set_id: sourceAlbum.template_set_id ?? null,
      print_type: sourceAlbum.print_type ?? null,
      section_structure_preset_id:
        sourceAlbum.section_structure_preset_id ?? null,
      include_non_purchasers: sourceAlbum.include_non_purchasers ?? false,
      // archived и вновь созданные служебные поля БД заполняет сама
    }

    const { data: newAlbum, error: insertErr } = await supabaseAdmin
      .from('albums')
      .insert(albumInsert)
      .select()
      .single()
    if (insertErr || !newAlbum) {
      return NextResponse.json(
        { error: insertErr?.message ?? 'Не удалось создать копию альбома' },
        { status: 500 },
      )
    }

    const newAlbumId = String(newAlbum.id)

    // Хелпер: при первой же ошибке откатываем (удаляем) новый альбом
    // через CASCADE — БД сама удалит все FK-зависимости.
    const rollback = async (errorMsg: string, status = 500) => {
      await supabaseAdmin.from('albums').delete().eq('id', newAlbumId)
      return NextResponse.json({ error: errorMsg }, { status })
    }

    // ─── 4) Копируем children (получаем map old→new id) ────────────
    const { data: sourceChildren, error: chFetchErr } = await supabaseAdmin
      .from('children')
      .select('*')
      .eq('album_id', sourceAlbumId)
    if (chFetchErr) {
      return rollback(`Загрузка учеников: ${chFetchErr.message}`)
    }

    const childIdMap = new Map<string, string>() // oldId → newId
    if (sourceChildren && sourceChildren.length > 0) {
      const childRows = sourceChildren.map((c: Record<string, unknown>) => {
        // Копируем ВСЕ поля кроме служебных. БД сама сгенерирует:
        //   id (uuid default), access_token (default), created_at
        //   submitted_at и started_at — сбрасываем (копия начинает заново)
        const row: Record<string, unknown> = {
          album_id: newAlbumId,
          full_name: c.full_name,
          class: c.class,
          is_purchased: c.is_purchased ?? false,
          // started_at / submitted_at НЕ копируем — это статусы прогресса.
          // Если копию используют для нового реального заказа — это правильно.
          // Если для теста — партнёр может вручную выставить.
        }
        // Опциональные поля если есть в source — копируем.
        if (c.config_preset_id !== undefined && c.config_preset_id !== null) {
          row.config_preset_id = c.config_preset_id
        }
        return row
      })
      const { data: newChildren, error: chInsErr } = await supabaseAdmin
        .from('children')
        .insert(childRows)
        .select('id')
      if (chInsErr || !newChildren) {
        return rollback(`Создание учеников: ${chInsErr?.message ?? 'unknown'}`)
      }
      // Связываем по индексу — порядок INSERT сохраняется в Postgres.
      sourceChildren.forEach((src, idx) => {
        childIdMap.set(String(src.id), String(newChildren[idx].id))
      })
    }

    // ─── 5) Копируем teachers ─────────────────────────────────────
    const { data: sourceTeachers, error: tFetchErr } = await supabaseAdmin
      .from('teachers')
      .select('*')
      .eq('album_id', sourceAlbumId)
    if (tFetchErr) {
      return rollback(`Загрузка учителей: ${tFetchErr.message}`)
    }

    const teacherIdMap = new Map<string, string>()
    if (sourceTeachers && sourceTeachers.length > 0) {
      const teacherRows = sourceTeachers.map((t: Record<string, unknown>) => {
        const row: Record<string, unknown> = {
          album_id: newAlbumId,
          full_name: t.full_name,
          position: t.position,
          is_head_teacher: t.is_head_teacher ?? false,
        }
        if (t.description !== undefined && t.description !== null) {
          row.description = t.description
        }
        return row
      })
      const { data: newTeachers, error: tInsErr } = await supabaseAdmin
        .from('teachers')
        .insert(teacherRows)
        .select('id')
      if (tInsErr || !newTeachers) {
        return rollback(`Создание учителей: ${tInsErr?.message ?? 'unknown'}`)
      }
      sourceTeachers.forEach((src, idx) => {
        teacherIdMap.set(String(src.id), String(newTeachers[idx].id))
      })
    }

    // ─── 6) Копируем responsible_parents ──────────────────────────
    const { data: sourceResp, error: rFetchErr } = await supabaseAdmin
      .from('responsible_parents')
      .select('*')
      .eq('album_id', sourceAlbumId)
    if (rFetchErr) {
      return rollback(`Загрузка ответственных: ${rFetchErr.message}`)
    }
    if (sourceResp && sourceResp.length > 0) {
      const respRows = sourceResp.map((r: Record<string, unknown>) => ({
        album_id: newAlbumId,
        full_name: r.full_name,
        phone: r.phone,
      }))
      const { error: rInsErr } = await supabaseAdmin
        .from('responsible_parents')
        .insert(respRows)
      if (rInsErr) {
        return rollback(`Создание ответственных: ${rInsErr.message}`)
      }
    }

    // ─── 7) Копируем photos (метаданные + storage_path тот же) ─────
    const { data: sourcePhotos, error: phFetchErr } = await supabaseAdmin
      .from('photos')
      .select('*')
      .eq('album_id', sourceAlbumId)
    if (phFetchErr) {
      return rollback(`Загрузка фото: ${phFetchErr.message}`)
    }

    const photoIdMap = new Map<string, string>()
    if (sourcePhotos && sourcePhotos.length > 0) {
      const photoRows = sourcePhotos.map((p: Record<string, unknown>) => {
        const row: Record<string, unknown> = {
          album_id: newAlbumId,
          filename: p.filename,
          storage_path: p.storage_path,
          thumb_path: p.thumb_path ?? null,
          type: p.type ?? null,
        }
        if (p.original_path !== undefined && p.original_path !== null) {
          row.original_path = p.original_path
        }
        return row
      })
      const { data: newPhotos, error: phInsErr } = await supabaseAdmin
        .from('photos')
        .insert(photoRows)
        .select('id')
      if (phInsErr || !newPhotos) {
        return rollback(`Создание фото: ${phInsErr?.message ?? 'unknown'}`)
      }
      sourcePhotos.forEach((src, idx) => {
        photoIdMap.set(String(src.id), String(newPhotos[idx].id))
      })
    }

    // ─── 8) Копируем original_photos (оригиналы для печати) ────────
    const { data: sourceOrigs, error: oFetchErr } = await supabaseAdmin
      .from('original_photos')
      .select('*')
      .eq('album_id', sourceAlbumId)
    if (oFetchErr) {
      return rollback(`Загрузка оригиналов: ${oFetchErr.message}`)
    }
    if (sourceOrigs && sourceOrigs.length > 0) {
      const origRows = sourceOrigs.map((o: Record<string, unknown>) => ({
        album_id: newAlbumId,
        tenant_id: auth.tenantId,
        filename: o.filename,
        storage_path: o.storage_path,
        file_size: o.file_size,
        uploaded_by: o.uploaded_by ?? null,
      }))
      const { error: oInsErr } = await supabaseAdmin
        .from('original_photos')
        .insert(origRows)
      if (oInsErr) {
        return rollback(`Создание оригиналов: ${oInsErr.message}`)
      }
    }

    // ─── 9) Копируем quotes (цитаты пресета) ──────────────────────
    const { data: sourceQuotes, error: qFetchErr } = await supabaseAdmin
      .from('quotes')
      .select('*')
      .eq('album_id', sourceAlbumId)
    if (qFetchErr) {
      return rollback(`Загрузка цитат: ${qFetchErr.message}`)
    }

    const quoteIdMap = new Map<string, string>()
    if (sourceQuotes && sourceQuotes.length > 0) {
      const quoteRows = sourceQuotes.map((q: Record<string, unknown>) => {
        const row: Record<string, unknown> = { album_id: newAlbumId }
        // Все нестандартные поля копируем (text и любые другие).
        for (const k of Object.keys(q)) {
          if (k === 'id' || k === 'album_id' || k === 'created_at') continue
          row[k] = q[k]
        }
        return row
      })
      const { data: newQuotes, error: qInsErr } = await supabaseAdmin
        .from('quotes')
        .insert(quoteRows)
        .select('id')
      if (qInsErr || !newQuotes) {
        return rollback(`Создание цитат: ${qInsErr?.message ?? 'unknown'}`)
      }
      sourceQuotes.forEach((src, idx) => {
        quoteIdMap.set(String(src.id), String(newQuotes[idx].id))
      })
    }

    // ─── 10) Копируем дочерние таблицы (FK через child_id) ─────────
    //
    // Все они привязаны к child_id, не к album_id. Используем childIdMap.
    // Если childIdMap пуст (нет учеников) — эти таблицы тоже пустые.

    const childIdsOld = Array.from(childIdMap.keys())

    if (childIdsOld.length > 0) {
      // 10a. student_texts (текст от родителя)
      const { data: stRows, error: stErr } = await supabaseAdmin
        .from('student_texts')
        .select('*')
        .in('child_id', childIdsOld)
      if (stErr) {
        return rollback(`Загрузка текстов: ${stErr.message}`)
      }
      if (stRows && stRows.length > 0) {
        const newStRows = stRows
          .map((r: Record<string, unknown>) => ({
            child_id: childIdMap.get(String(r.child_id)),
            text: r.text,
          }))
          .filter((r) => r.child_id) // безопасность
        if (newStRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('student_texts')
            .insert(newStRows)
          if (error) return rollback(`Тексты: ${error.message}`)
        }
      }

      // 10b. parent_contacts (родитель + телефон)
      const { data: pcRows, error: pcErr } = await supabaseAdmin
        .from('parent_contacts')
        .select('*')
        .in('child_id', childIdsOld)
      if (pcErr) {
        return rollback(`Загрузка контактов: ${pcErr.message}`)
      }
      if (pcRows && pcRows.length > 0) {
        const newPcRows = pcRows
          .map((r: Record<string, unknown>) => ({
            child_id: childIdMap.get(String(r.child_id)),
            parent_name: r.parent_name,
            phone: r.phone,
          }))
          .filter((r) => r.child_id)
        if (newPcRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('parent_contacts')
            .insert(newPcRows)
          if (error) return rollback(`Контакты: ${error.message}`)
        }
      }

      // 10c. selections (выбор фото родителем): child_id + photo_id
      const { data: selRows, error: selErr } = await supabaseAdmin
        .from('selections')
        .select('*')
        .in('child_id', childIdsOld)
      if (selErr) {
        return rollback(`Загрузка выбора фото: ${selErr.message}`)
      }
      if (selRows && selRows.length > 0) {
        const newSelRows = selRows
          .map((r: Record<string, unknown>) => ({
            child_id: childIdMap.get(String(r.child_id)),
            photo_id: photoIdMap.get(String(r.photo_id)),
            selection_type: r.selection_type,
          }))
          .filter((r) => r.child_id && r.photo_id)
        if (newSelRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('selections')
            .insert(newSelRows)
          if (error) return rollback(`Выбор фото: ${error.message}`)
        }
      }

      // 10d. photo_children (теги «кто на фото»): child_id + photo_id
      const { data: pchRows, error: pchErr } = await supabaseAdmin
        .from('photo_children')
        .select('*')
        .in('child_id', childIdsOld)
      if (pchErr) {
        return rollback(`Загрузка тегов фото: ${pchErr.message}`)
      }
      if (pchRows && pchRows.length > 0) {
        const newPchRows = pchRows
          .map((r: Record<string, unknown>) => ({
            child_id: childIdMap.get(String(r.child_id)),
            photo_id: photoIdMap.get(String(r.photo_id)),
          }))
          .filter((r) => r.child_id && r.photo_id)
        if (newPchRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('photo_children')
            .upsert(newPchRows, {
              onConflict: 'photo_id,child_id',
              ignoreDuplicates: true,
            })
          if (error) return rollback(`Теги фото (дети): ${error.message}`)
        }
      }

      // 10e. cover_selections (выбор обложки): child_id + photo_id (опц.)
      const { data: csRows, error: csErr } = await supabaseAdmin
        .from('cover_selections')
        .select('*')
        .in('child_id', childIdsOld)
      if (csErr) {
        return rollback(`Загрузка выбора обложки: ${csErr.message}`)
      }
      if (csRows && csRows.length > 0) {
        const newCsRows = csRows
          .map((r: Record<string, unknown>) => {
            const childId = childIdMap.get(String(r.child_id))
            if (!childId) return null
            const photoId = r.photo_id
              ? photoIdMap.get(String(r.photo_id)) ?? null
              : null
            return {
              child_id: childId,
              cover_option: r.cover_option ?? 'none',
              photo_id: photoId,
              surcharge: r.surcharge ?? 0,
            }
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
        if (newCsRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('cover_selections')
            .insert(newCsRows)
          if (error) return rollback(`Выбор обложки: ${error.message}`)
        }
      }

      // 10f. quote_selections (выбор цитаты): child_id + quote_id
      const { data: qsRows, error: qsErr } = await supabaseAdmin
        .from('quote_selections')
        .select('*')
        .in('child_id', childIdsOld)
      if (qsErr) {
        return rollback(`Загрузка выбора цитат: ${qsErr.message}`)
      }
      if (qsRows && qsRows.length > 0) {
        const newQsRows = qsRows
          .map((r: Record<string, unknown>) => ({
            child_id: childIdMap.get(String(r.child_id)),
            quote_id: quoteIdMap.get(String(r.quote_id)),
          }))
          .filter((r) => r.child_id && r.quote_id)
        if (newQsRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('quote_selections')
            .insert(newQsRows)
          if (error) return rollback(`Выбор цитат: ${error.message}`)
        }
      }

      // 10g. personal_spread_photos (личные развороты)
      const { data: pspRows, error: pspErr } = await supabaseAdmin
        .from('personal_spread_photos')
        .select('*')
        .in('child_id', childIdsOld)
      if (pspErr) {
        return rollback(`Загрузка личных разворотов: ${pspErr.message}`)
      }
      if (pspRows && pspRows.length > 0) {
        const newPspRows = pspRows
          .map((r: Record<string, unknown>) => {
            const childId = childIdMap.get(String(r.child_id))
            if (!childId) return null
            const out: Record<string, unknown> = { child_id: childId }
            // Копируем все поля кроме id/child_id/created_at
            for (const k of Object.keys(r)) {
              if (k === 'id' || k === 'child_id' || k === 'created_at') continue
              out[k] = r[k]
            }
            return out
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
        if (newPspRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('personal_spread_photos')
            .insert(newPspRows)
          if (error) return rollback(`Личные развороты: ${error.message}`)
        }
      }
    }

    // ─── 11) photo_teachers (FK через teacher_id + photo_id) ───────
    const teacherIdsOld = Array.from(teacherIdMap.keys())
    if (teacherIdsOld.length > 0) {
      const { data: ptRows, error: ptErr } = await supabaseAdmin
        .from('photo_teachers')
        .select('*')
        .in('teacher_id', teacherIdsOld)
      if (ptErr) {
        return rollback(`Загрузка тегов учителей: ${ptErr.message}`)
      }
      if (ptRows && ptRows.length > 0) {
        const newPtRows = ptRows
          .map((r: Record<string, unknown>) => ({
            teacher_id: teacherIdMap.get(String(r.teacher_id)),
            photo_id: photoIdMap.get(String(r.photo_id)),
          }))
          .filter((r) => r.teacher_id && r.photo_id)
        if (newPtRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('photo_teachers')
            .upsert(newPtRows, {
              onConflict: 'photo_id,teacher_id',
              ignoreDuplicates: true,
            })
          if (error) return rollback(`Теги фото (учителя): ${error.message}`)
        }
      }
    }

    // ─── 12) Аудит-лог + возврат ──────────────────────────────────
    await logAction(auth, 'album.clone', 'album', newAlbumId, {
      source_album_id: sourceAlbumId,
      source_title: sourceAlbum.title,
      new_title: newTitle,
      children_count: childIdMap.size,
      teachers_count: teacherIdMap.size,
      photos_count: photoIdMap.size,
    })

    return NextResponse.json({
      id: newAlbumId,
      title: newTitle,
      stats: {
        children: childIdMap.size,
        teachers: teacherIdMap.size,
        photos: photoIdMap.size,
        quotes: quoteIdMap.size,
      },
    })
  }

  // ----------------------------------------------------------
  // update_album — редактирование настроек альбома
  // ----------------------------------------------------------
  if (body.action === 'update_album') {
    const { album_id } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Резолв preset_slug → config_preset_id + print_type (фаза 0.5.6.1)
    if (typeof body.preset_slug === 'string' && body.preset_slug.length > 0) {
      const preset = await resolvePresetBySlug(body.preset_slug)
      if (!preset) {
        return NextResponse.json(
          { error: `preset_slug ${body.preset_slug} not found` },
          { status: 400 },
        )
      }
      body.config_preset_id = preset.id
      body.print_type = preset.print_type
    }

    // Auto-resolve template_set_id если у альбома его ещё нет
    if (body.template_set_id === undefined) {
      const { data: existing } = await supabaseAdmin
        .from('albums')
        .select('template_set_id')
        .eq('id', album_id)
        .single()
      if (!existing?.template_set_id) {
        const tsId = await getDefaultTemplateSetId()
        if (tsId) body.template_set_id = tsId
      }
    }

    // РЭ.24.6: если приходит section_structure_preset_id — это новый
    // путь через каталог. Резолвим preset, подтягиваем template_set_id
    // и print_type из него, очищаем legacy config_preset_id.
    // Если приходит null — снимаем шаблон (валидно — альбом разрешён
    // существовать без шаблона до явного выбора партнёром).
    if ('section_structure_preset_id' in body) {
      const newVal = body.section_structure_preset_id
      if (newVal === null) {
        // Снятие шаблона — больше ничего не подтягиваем, legacy
        // обработается ниже своим путём (если придёт preset_slug).
      } else if (typeof newVal === 'string' && newVal.length > 0) {
        const { data: ps, error: psErr } = await supabaseAdmin
          .from('presets')
          .select('id, tenant_id, template_set_id, print_type')
          .eq('id', newVal)
          .maybeSingle()
        if (psErr) {
          return NextResponse.json({ error: psErr.message }, { status: 500 })
        }
        if (!ps) {
          return NextResponse.json({ error: 'Шаблон не найден' }, { status: 400 })
        }
        const accessible =
          ps.tenant_id === null ||
          ps.tenant_id === auth.tenantId ||
          auth.role === 'superadmin'
        if (!accessible) {
          return NextResponse.json({ error: 'Шаблон недоступен' }, { status: 403 })
        }
        // Подтягиваем из шаблона если в body не передано явно
        if (ps.template_set_id) body.template_set_id = ps.template_set_id
        // РЭ.27.2: print_type подтягиваем из пресета ТОЛЬКО если в body
        // не передан явно. Партнёр может через update_album поменять тип
        // листов независимо от пресета (это и есть цель РЭ.27).
        if (ps.print_type && body.print_type === undefined) {
          body.print_type = ps.print_type
        }
        // Legacy преcет очищаем — новый шаблон приоритетнее
        body.config_preset_id = null
        // preset_slug если пришёл одновременно — игнорируем
        delete body.preset_slug
      } else {
        return NextResponse.json(
          { error: 'section_structure_preset_id должен быть string или null' },
          { status: 400 },
        )
      }
    }

    // РЭ.27.2: явная валидация print_type до записи в БД.
    // На уровне БД CHECK constraint уже работает (с 8 мая 2026), но
    // 400 от API лучше чем 500 от Supabase.
    if (body.print_type !== undefined && body.print_type !== null) {
      const pt = String(body.print_type)
      if (pt !== 'layflat' && pt !== 'soft') {
        return NextResponse.json(
          { error: `print_type должен быть 'layflat' или 'soft', получено: ${pt}` },
          { status: 400 },
        )
      }
    }

    // Список разрешённых полей
    const allowedFields = [
      'title', 'city', 'year', 'deadline',
      'cover_mode', 'cover_price',
      'group_enabled', 'group_min', 'group_max', 'group_exclusive',
      'personal_spread_enabled', 'personal_spread_price', 'personal_spread_min', 'personal_spread_max',
      'text_enabled', 'text_max_chars', 'text_type',
      'classes', 'template_title',
      'print_type',
      'config_preset_id',
      'template_set_id',
      'vignettes_enabled',  // А.3.4 — override виньеток (true/false/null)
      'common_section_max_spreads',  // А.4 — лимит разворотов общего раздела (number/null)
      'section_structure_preset_id',  // РЭ.21.8.7 — если задан, build_album использует
                                       // buildFromSectionStructure (РЭ.21.8.чистка-1:
                                       // раньше был промежуточный rules_preset_id движка 2,
                                       // удалён вместе с движком)
      'include_non_purchasers',  // РЭ.25: включать ли не-заказчиков (children.is_purchased=false)
                                  // в персональные страницы. Default false (строгое).
    ]
    const updates: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('albums')
      .update(updates)
      .eq('id', album_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.update', 'album', album_id, { fields: Object.keys(updates) })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // archive_album — в архив + удаление файлов фото
  // ----------------------------------------------------------
  if (body.action === 'archive_album') {
    const { album_id } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Удаляем файлы фото из Storage (экономим место)
    const { data: photos } = await supabaseAdmin
      .from('photos')
      .select('storage_path, thumb_path')
      .eq('album_id', album_id)

    if (photos && photos.length > 0) {
      const paths: string[] = []
      for (const p of photos as any[]) {
        if (p.storage_path) paths.push(p.storage_path)
        if (p.thumb_path) paths.push(p.thumb_path)
      }
      // Батчами по 100
      for (let i = 0; i < paths.length; i += 100) {
        await supabaseAdmin.storage.from('photos').remove(paths.slice(i, i + 100))
      }
    }

    // Удаляем записи photos (selections удалятся каскадно через album_id)
    await supabaseAdmin.from('photos').delete().eq('album_id', album_id)

    // Ставим флаг архива
    const { error } = await supabaseAdmin
      .from('albums')
      .update({ archived: true })
      .eq('id', album_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.archive', 'album', album_id, {
      photos_deleted: photos?.length ?? 0,
    })

    return NextResponse.json({ ok: true, deleted: photos?.length ?? 0 })
  }

  // ----------------------------------------------------------
  // unarchive_album — вернуть из архива
  // ----------------------------------------------------------
  if (body.action === 'unarchive_album') {
    const { album_id } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Проверяем лимит (возврат из архива считается как новый активный)
    if (auth.role !== 'superadmin') {
      const [{ count: currentCount }, { data: tenant }] = await Promise.all([
        supabaseAdmin
          .from('albums')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenantId)
          .eq('archived', false),
        supabaseAdmin
          .from('tenants')
          .select('max_albums')
          .eq('id', auth.tenantId)
          .single(),
      ])

      if ((currentCount ?? 0) >= (tenant?.max_albums ?? 0)) {
        return NextResponse.json(
          {
            error: `Достигнут лимит активных альбомов (${tenant?.max_albums}). Архивируйте другой или обновите тариф.`,
          },
          { status: 403 }
        )
      }
    }

    const { error } = await supabaseAdmin
      .from('albums')
      .update({ archived: false })
      .eq('id', album_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.unarchive', 'album', album_id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_album — полное удаление альбома (необратимо)
  // ----------------------------------------------------------
  if (body.action === 'delete_album') {
    const { album_id } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // 1. Удаляем файлы фото из Storage
    const { data: photos } = await supabaseAdmin
      .from('photos')
      .select('storage_path, thumb_path')
      .eq('album_id', album_id)

    if (photos && photos.length > 0) {
      const paths: string[] = []
      for (const p of photos as any[]) {
        if (p.storage_path) paths.push(p.storage_path)
        if (p.thumb_path) paths.push(p.thumb_path)
      }
      for (let i = 0; i < paths.length; i += 100) {
        await supabaseAdmin.storage.from('photos').remove(paths.slice(i, i + 100))
      }
    }

    // 2. Удаляем связанные записи (явно, без CASCADE через PostgREST)
    await supabaseAdmin.from('photos').delete().eq('album_id', album_id)
    await supabaseAdmin.from('children').delete().eq('album_id', album_id)
    await supabaseAdmin.from('teachers').delete().eq('album_id', album_id)
    await supabaseAdmin.from('responsible_parents').delete().eq('album_id', album_id)

    // 3. Удаляем сам альбом
    const { error } = await supabaseAdmin
      .from('albums')
      .delete()
      .eq('id', album_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'album.delete', 'album', album_id, {
      photos_deleted: photos?.length ?? 0,
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // add_child — добавить одного ученика
  // ----------------------------------------------------------
  if (body.action === 'add_child') {
    const { album_id, full_name, class: childClass } = body
    if (!album_id || !full_name?.trim() || !childClass?.trim()) {
      return NextResponse.json({ error: 'album_id, ФИО и класс обязательны' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data, error } = await supabaseAdmin
      .from('children')
      .insert({
        album_id,
        full_name: full_name.trim(),
        class: childClass.trim(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'child.create', 'child', data.id, {
      album_id,
      full_name: data.full_name,
      class: data.class,
    })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // import_children — массовый импорт учеников из CSV
  // ----------------------------------------------------------
  if (body.action === 'import_children') {
    const { album_id, rows } = body
    if (!album_id || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'album_id и rows обязательны' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Валидация и нормализация
    const toInsert: Array<{ album_id: string; full_name: string; class: string }> = []
    let skipped = 0
    for (const row of rows) {
      const full_name = String(row.full_name ?? row.name ?? '').trim()
      const childClass = String(row.class ?? row['класс'] ?? '').trim()
      if (!full_name || !childClass) {
        skipped++
        continue
      }
      toInsert.push({ album_id, full_name, class: childClass })
    }

    if (toInsert.length === 0) {
      return NextResponse.json(
        { error: 'Нет корректных строк для импорта', skipped },
        { status: 400 }
      )
    }

    // Получим существующих детей чтобы не дублировать
    const { data: existing } = await supabaseAdmin
      .from('children')
      .select('full_name, class')
      .eq('album_id', album_id)

    const existingSet = new Set(
      (existing ?? []).map((c: any) => `${c.full_name.toLowerCase()}|${c.class.toLowerCase()}`)
    )

    const filtered = toInsert.filter(c => {
      const key = `${c.full_name.toLowerCase()}|${c.class.toLowerCase()}`
      if (existingSet.has(key)) {
        skipped++
        return false
      }
      existingSet.add(key)
      return true
    })

    if (filtered.length === 0) {
      return NextResponse.json({ added: 0, skipped })
    }

    const { data, error } = await supabaseAdmin
      .from('children')
      .insert(filtered)
      .select('id, full_name, class, access_token')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'child.import', 'album', album_id, {
      added: data?.length ?? 0,
      skipped,
    })

    return NextResponse.json({ added: data?.length ?? 0, skipped, children: data })
  }

  // ----------------------------------------------------------
  // reset_child — сбросить выбор ученика (без удаления)
  // ----------------------------------------------------------
  if (body.action === 'reset_child') {
    const { child_id } = body
    if (!child_id) {
      return NextResponse.json({ error: 'child_id обязателен' }, { status: 400 })
    }

    if (!(await assertChildAccess(auth, child_id))) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    await Promise.all([
      supabaseAdmin.from('selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('photo_locks').delete().eq('child_id', child_id),
      supabaseAdmin.from('cover_selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('student_texts').delete().eq('child_id', child_id),
      supabaseAdmin.from('parent_contacts').delete().eq('child_id', child_id),
      supabaseAdmin.from('drafts').delete().eq('child_id', child_id),
      supabaseAdmin.from('quote_selections').delete().eq('child_id', child_id),
    ])

    await supabaseAdmin
      .from('children')
      .update({ submitted_at: null, started_at: null })
      .eq('id', child_id)

    await logAction(auth, 'child.reset', 'child', child_id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_child — полностью удалить ученика
  // ----------------------------------------------------------
  if (body.action === 'delete_child') {
    const { child_id } = body
    if (!child_id) {
      return NextResponse.json({ error: 'child_id обязателен' }, { status: 400 })
    }

    if (!(await assertChildAccess(auth, child_id))) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    // Получим данные ребёнка для audit log
    const { data: child } = await supabaseAdmin
      .from('children')
      .select('full_name, class, album_id')
      .eq('id', child_id)
      .single()

    // Удаляем всё связанное
    await Promise.all([
      supabaseAdmin.from('photo_locks').delete().eq('child_id', child_id),
      supabaseAdmin.from('selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('parent_contacts').delete().eq('child_id', child_id),
      supabaseAdmin.from('cover_selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('quote_selections').delete().eq('child_id', child_id),
      supabaseAdmin.from('student_texts').delete().eq('child_id', child_id),
      supabaseAdmin.from('drafts').delete().eq('child_id', child_id),
      supabaseAdmin.from('photo_children').delete().eq('child_id', child_id),
    ])

    await supabaseAdmin.from('children').delete().eq('id', child_id)

    await logAction(auth, 'child.delete', 'child', child_id, {
      full_name: child?.full_name,
      class: child?.class,
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // update_child — патч-обновление ученика (РЭ.25)
  // Принимает любую комбинацию: full_name?, class?, is_purchased?
  // Если все поля undefined → 400.
  // ----------------------------------------------------------
  if (body.action === 'update_child') {
    const { child_id } = body
    if (!child_id) {
      return NextResponse.json({ error: 'child_id обязателен' }, { status: 400 })
    }

    if (!(await assertChildAccess(auth, child_id))) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}

    if (typeof body.full_name === 'string') {
      const trimmed = body.full_name.trim()
      if (!trimmed) {
        return NextResponse.json({ error: 'ФИО не может быть пустым' }, { status: 400 })
      }
      updates.full_name = trimmed
    }

    if (typeof body.class === 'string') {
      const trimmed = body.class.trim()
      if (!trimmed) {
        return NextResponse.json({ error: 'Класс не может быть пустым' }, { status: 400 })
      }
      updates.class = trimmed
    }

    if (typeof body.is_purchased === 'boolean') {
      updates.is_purchased = body.is_purchased
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('children')
      .update(updates)
      .eq('id', child_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'child.update', 'child', child_id, {
      fields: Object.keys(updates),
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // update_child_preset — назначить override config_preset для ученика
  // (preset_slug='' / null / undefined → сброс override на NULL)
  // ----------------------------------------------------------
  if (body.action === 'update_child_preset') {
    const { child_id, preset_slug } = body
    if (!child_id) {
      return NextResponse.json({ error: 'child_id обязателен' }, { status: 400 })
    }

    if (!(await assertChildAccess(auth, child_id))) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    let configPresetId: string | null = null
    if (typeof preset_slug === 'string' && preset_slug.length > 0) {
      const preset = await resolvePresetBySlug(preset_slug)
      if (!preset) {
        return NextResponse.json(
          { error: `preset_slug ${preset_slug} not found` },
          { status: 400 },
        )
      }
      configPresetId = preset.id
    }

    const { error } = await supabaseAdmin
      .from('children')
      .update({ config_preset_id: configPresetId })
      .eq('id', child_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'child.update_preset', 'child', child_id, {
      preset_slug: typeof preset_slug === 'string' ? preset_slug : null,
    })

    return NextResponse.json({ ok: true })
  }

  // ============================================================
  // УЧИТЕЛЯ
  // ============================================================

  // ----------------------------------------------------------
  // add_teacher — добавить учителя (ФИО и должность опциональны)
  // ----------------------------------------------------------
  if (body.action === 'add_teacher') {
    const { album_id, full_name, position } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    const { data, error } = await supabaseAdmin
      .from('teachers')
      .insert({
        album_id,
        full_name: full_name?.trim() || null,
        position: position?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'teacher.create', 'teacher', data.id, {
      album_id,
      full_name: data.full_name,
    })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // update_teacher — редактирование данных учителя
  // ----------------------------------------------------------
  if (body.action === 'update_teacher') {
    const { teacher_id, full_name, position, description, is_head_teacher } = body
    if (!teacher_id) {
      return NextResponse.json({ error: 'teacher_id обязателен' }, { status: 400 })
    }

    if (!(await assertTeacherAccess(auth, teacher_id))) {
      return NextResponse.json({ error: 'Учитель не найден' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if (full_name !== undefined) updates.full_name = full_name?.trim() || null
    if (position !== undefined) updates.position = position?.trim() || null
    if (description !== undefined) updates.description = description?.trim() || ''

    const headFlagProvided = is_head_teacher !== undefined
    const wantHead = is_head_teacher === true

    if (Object.keys(updates).length === 0 && !headFlagProvided) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    // Radio-pattern: если выставляем is_head_teacher=true — сначала
    // сбросить флаг у остальных учителей того же альбома (partial unique
    // index не разрешит двух head на альбом).
    if (headFlagProvided && wantHead) {
      const { data: teacherRow, error: fetchErr } = await supabaseAdmin
        .from('teachers')
        .select('album_id')
        .eq('id', teacher_id)
        .single()

      if (fetchErr || !teacherRow) {
        return NextResponse.json({ error: 'Учитель не найден' }, { status: 404 })
      }

      const { error: resetErr } = await supabaseAdmin
        .from('teachers')
        .update({ is_head_teacher: false })
        .eq('album_id', teacherRow.album_id)
        .neq('id', teacher_id)

      if (resetErr) {
        return NextResponse.json({ error: resetErr.message }, { status: 500 })
      }
    }

    if (headFlagProvided) {
      updates.is_head_teacher = wantHead
    }

    const { error } = await supabaseAdmin
      .from('teachers')
      .update(updates)
      .eq('id', teacher_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'teacher.update', 'teacher', teacher_id, {
      fields: Object.keys(updates),
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_teacher — удаление учителя
  // ----------------------------------------------------------
  if (body.action === 'delete_teacher') {
    const { teacher_id } = body
    if (!teacher_id) {
      return NextResponse.json({ error: 'teacher_id обязателен' }, { status: 400 })
    }

    if (!(await assertTeacherAccess(auth, teacher_id))) {
      return NextResponse.json({ error: 'Учитель не найден' }, { status: 404 })
    }

    await supabaseAdmin.from('photo_teachers').delete().eq('teacher_id', teacher_id)
    await supabaseAdmin.from('teachers').delete().eq('id', teacher_id)

    await logAction(auth, 'teacher.delete', 'teacher', teacher_id)

    return NextResponse.json({ ok: true })
  }

  // ============================================================
  // ОТВЕТСТВЕННЫЙ РОДИТЕЛЬ
  // ============================================================

  // ----------------------------------------------------------
  // create_responsible — создать ответственного родителя (один на альбом)
  // ----------------------------------------------------------
  if (body.action === 'create_responsible') {
    const { album_id, full_name, phone } = body
    if (!album_id) {
      return NextResponse.json({ error: 'album_id обязателен' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Проверяем, что нет уже существующего
    const { data: existing } = await supabaseAdmin
      .from('responsible_parents')
      .select('id')
      .eq('album_id', album_id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'Ответственный родитель для этого альбома уже создан' },
        { status: 409 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('responsible_parents')
      .insert({
        album_id,
        full_name: full_name?.trim() || null,
        phone: phone?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'responsible.create', 'responsible', data.id, { album_id })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // update_responsible — обновить данные ответственного
  // ----------------------------------------------------------
  if (body.action === 'update_responsible') {
    const { responsible_id, full_name, phone } = body
    if (!responsible_id) {
      return NextResponse.json({ error: 'responsible_id обязателен' }, { status: 400 })
    }

    if (!(await assertResponsibleAccess(auth, responsible_id))) {
      return NextResponse.json({ error: 'Ответственный не найден' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if (full_name !== undefined) updates.full_name = full_name?.trim() || null
    if (phone !== undefined) updates.phone = phone?.trim() || null

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('responsible_parents')
      .update(updates)
      .eq('id', responsible_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, 'responsible.update', 'responsible', responsible_id, {
      fields: Object.keys(updates),
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_responsible — удалить ответственного
  // ----------------------------------------------------------
  if (body.action === 'delete_responsible') {
    const { responsible_id } = body
    if (!responsible_id) {
      return NextResponse.json({ error: 'responsible_id обязателен' }, { status: 400 })
    }

    if (!(await assertResponsibleAccess(auth, responsible_id))) {
      return NextResponse.json({ error: 'Ответственный не найден' }, { status: 404 })
    }

    await supabaseAdmin.from('responsible_parents').delete().eq('id', responsible_id)

    await logAction(auth, 'responsible.delete', 'responsible', responsible_id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // register_photo — регистрация уже загруженного файла в БД
  // Используется при клиентской компрессии (быстрая параллельная загрузка).
  // Клиент сам заливает файл в Storage под путём album_id/type/ts_name.webp,
  // затем вызывает этот endpoint для создания записи в photos.
  // type ∈ {portrait, group, teacher,
  //         common_spread, common_full, common_half,
  //         common_quarter, common_sixth}.
  // ----------------------------------------------------------
  if (body.action === 'register_photo') {
    const { album_id, filename, storage_path, thumb_path, type } = body

    if (!album_id || !filename || !storage_path || !type) {
      return NextResponse.json({ error: 'Не хватает данных' }, { status: 400 })
    }

    if (!['portrait', 'group', 'teacher',
          'common_spread', 'common_full', 'common_half',
          'common_quarter', 'common_sixth'].includes(type)) {
      return NextResponse.json({ error: 'Неверный type' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Защита: клиент не может подсунуть чужой путь — требуем,
    // чтобы storage_path начинался с album_id/
    if (!storage_path.startsWith(`${album_id}/`)) {
      return NextResponse.json({ error: 'Недопустимый storage_path' }, { status: 400 })
    }
    if (thumb_path && !thumb_path.startsWith(`${album_id}/`)) {
      return NextResponse.json({ error: 'Недопустимый thumb_path' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('photos')
      .insert({
        album_id,
        filename,
        storage_path,
        thumb_path: thumb_path ?? null,
        type,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'photo.register', 'photo', (data as any).id, {
      album_id,
      type,
      filename,
    })

    return NextResponse.json(data)
  }

  // ----------------------------------------------------------
  // register_original — регистрация оригинала фото в БД (Б.1.2)
  // Используется после успешной загрузки оригинала через presigned URL.
  //
  // Поток (см. Б.1.3 в page.tsx):
  //   1. Клиент компрессирует → POST /api/upload → photo_id + WebP в storage_path
  //   2. Клиент параллельно: POST /api/upload-url с upload_type='originals' →
  //      presigned URL + storage_path для originals
  //   3. Клиент PUT'ом заливает оригинал в YC по presigned URL
  //   4. Клиент: POST register_original с photo_id + storage_path оригинала →
  //      UPDATE photos SET original_path
  //
  // Storage path validation: должен начинаться с album_id/originals/
  // и фото должно принадлежать тому же album_id. Защита от подмены.
  // ----------------------------------------------------------
  if (body.action === 'register_original') {
    const { photo_id, original_path } = body

    if (!photo_id || !original_path) {
      return NextResponse.json({ error: 'photo_id и original_path обязательны' }, { status: 400 })
    }

    // Получаем фото с проверкой принадлежности тенанту (assertAlbumAccess внутри).
    const photo = await getOwnedPhoto(auth, photo_id)
    if (!photo) {
      return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 })
    }

    // Защита: original_path должен указывать на originals/ внутри того же
    // альбома. Иначе клиент мог бы подсунуть путь чужого альбома.
    // Принимаем оба формата для гибкости: с префиксом yc: и без.
    const cleanPath = original_path.startsWith('yc:') ? original_path.slice(3) : original_path
    const expectedPrefix = `${(photo as { album_id: string }).album_id}/originals/`
    if (!cleanPath.startsWith(expectedPrefix)) {
      return NextResponse.json({
        error: `original_path должен начинаться с ${expectedPrefix}`,
      }, { status: 400 })
    }

    // Нормализуем — всегда храним с префиксом yc: для консистентности
    // с storage_path (см. lib/supabase.ts getPhotoUrl).
    const normalizedPath = original_path.startsWith('yc:') ? original_path : `yc:${original_path}`

    const { error } = await supabaseAdmin
      .from('photos')
      .update({ original_path: normalizedPath })
      .eq('id', photo_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'photo.register_original', 'photo', photo_id, {
      original_path: normalizedPath,
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_photos_by_type — массовое удаление всех фото категории
  // (портреты / групповые / учителя / общий: разворот/полный/половина/...)
  // 11.05.2026: запрошено для быстрой очистки тестовых альбомов и
  // случаев когда фотограф загрузил весь батч не в ту категорию.
  //
  // Поведение полностью повторяет delete_photo но в массовом порядке:
  //   - удаление WebP + thumb + оригинала (original_path) из YC
  //   - удаление всех связей (selections, photo_children, photo_teachers,
  //     photo_locks)
  //   - сброс submitted_at у затронутых детей (если фото уже было
  //     выбрано родителями)
  //   - audit_log
  //
  // Безопасность: requireAuth + assertAlbumAccess по tid (учитывает
  // view_as для сотрудников OkeyBook). Viewer не может удалять.
  // ----------------------------------------------------------
  if (body.action === 'delete_photos_by_type') {
    if (auth.role === 'viewer') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const { album_id, photo_type } = body
    if (!album_id || !photo_type) {
      return NextResponse.json({ error: 'album_id и photo_type обязательны' }, { status: 400 })
    }
    const allowedTypes = [
      'portrait', 'group', 'teacher',
      'common_spread', 'common_full', 'common_half', 'common_quarter', 'common_sixth',
    ]
    if (!allowedTypes.includes(photo_type)) {
      return NextResponse.json({ error: 'неизвестный photo_type' }, { status: 400 })
    }
    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // 1. Достаём все фото категории — для удаления файлов из YC
    //    и для подсчёта затронутых детей.
    const { data: photos, error: photosErr } = await supabaseAdmin
      .from('photos')
      .select('id, storage_path, thumb_path, original_path, filename')
      .eq('album_id', album_id)
      .eq('type', photo_type)
    if (photosErr) return NextResponse.json({ error: photosErr.message }, { status: 500 })

    if (!photos || photos.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0, resetChildren: 0 })
    }

    const photoIds = photos.map((p: any) => p.id)

    // 2. Какие дети выбирали эти фото — им нужно сбросить submitted_at.
    const { data: affectedSelections } = await supabaseAdmin
      .from('selections')
      .select('child_id')
      .in('photo_id', photoIds)
    const affectedChildIds = Array.from(
      new Set((affectedSelections ?? []).map((s: any) => s.child_id))
    )

    // 3. Удаление файлов из YC параллельно. Каждый photo может иметь
    //    до 3 файлов (storage_path/thumb_path/original_path). Ошибки
    //    ycDelete не критичны — даже если YC уже удалил файл, БД-запись
    //    нужно убрать.
    const deletePaths: string[] = []
    for (const p of photos as any[]) {
      if (p.storage_path && isYcPath(p.storage_path)) deletePaths.push(p.storage_path)
      if (p.thumb_path && isYcPath(p.thumb_path)) deletePaths.push(p.thumb_path)
      if (p.original_path && isYcPath(p.original_path)) deletePaths.push(p.original_path)
    }
    // Для очень больших категорий (тысячи фото) — батчим по 50 параллельно,
    // чтобы не выгрузить сеть и не упереться в Vercel function timeout.
    const BATCH = 50
    for (let i = 0; i < deletePaths.length; i += BATCH) {
      const batch = deletePaths.slice(i, i + BATCH)
      await Promise.all(batch.map((p) => ycDelete(stripYcPrefix(p)).catch(() => null)))
    }

    // 4. Удаляем все связи и сами фото. Порядок важен — сначала связи,
    //    потом photos (хоть FK с ON DELETE CASCADE и сделал бы это
    //    автоматически, явное удаление яснее для аудита).
    await supabaseAdmin.from('selections').delete().in('photo_id', photoIds)
    await supabaseAdmin.from('photo_teachers').delete().in('photo_id', photoIds)
    await supabaseAdmin.from('photo_children').delete().in('photo_id', photoIds)
    await supabaseAdmin.from('photo_locks').delete().in('photo_id', photoIds)
    await supabaseAdmin.from('photos').delete().in('id', photoIds)

    // 5. Сброс submitted_at у затронутых детей
    if (affectedChildIds.length > 0) {
      await supabaseAdmin.from('children')
        .update({ submitted_at: null })
        .in('id', affectedChildIds)
    }

    await logAction(auth, 'photo.delete_by_type', 'album', album_id, {
      photo_type,
      deleted: photos.length,
      reset_children: affectedChildIds.length,
    })

    return NextResponse.json({
      ok: true,
      deleted: photos.length,
      resetChildren: affectedChildIds.length,
    })
  }

  // ----------------------------------------------------------
  // delete_photo — удалить фото (+ thumb из Storage, + связи из БД)
  // Автоматически сбрасывает submitted_at у детей, которые выбрали это фото.
  // ----------------------------------------------------------
  if (body.action === 'delete_photo') {
    const { photo_id } = body
    if (!photo_id) {
      return NextResponse.json({ error: 'photo_id обязателен' }, { status: 400 })
    }

    const photo = await getOwnedPhoto(auth, photo_id)
    if (!photo) {
      return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 })
    }

    // Кто выбирал это фото — им надо сбросить submitted_at
    const { data: affectedSelections } = await supabaseAdmin
      .from('selections').select('child_id').eq('photo_id', photo_id)
    const affectedChildIds = Array.from(
      new Set((affectedSelections ?? []).map((s: any) => s.child_id))
    )

    // Удалить файлы из Storage (Supabase или YC)
    const deleteFromStorage = async (path: string) => {
      if (!path) return
      if (isYcPath(path)) {
        await ycDelete(stripYcPrefix(path))
      } else {
        await supabaseAdmin.storage.from('photos').remove([path])
      }
    }
    await Promise.all([
      photo.storage_path ? deleteFromStorage(photo.storage_path) : Promise.resolve(),
      photo.thumb_path ? deleteFromStorage(photo.thumb_path) : Promise.resolve(),
    ])

    // Удалить все связи
    await supabaseAdmin.from('selections').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_teachers').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_children').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photo_locks').delete().eq('photo_id', photo_id)
    await supabaseAdmin.from('photos').delete().eq('id', photo_id)

    // Сбросить submitted_at у затронутых
    if (affectedChildIds.length > 0) {
      await supabaseAdmin.from('children')
        .update({ submitted_at: null })
        .in('id', affectedChildIds)
    }

    await logAction(auth, 'photo.delete', 'photo', photo_id, {
      album_id: photo.album_id,
      filename: photo.filename,
      reset_children: affectedChildIds.length,
    })

    return NextResponse.json({ ok: true, resetChildren: affectedChildIds.length })
  }

  // ----------------------------------------------------------
  // tag_photo — привязать фото к ребёнку
  // ----------------------------------------------------------
  if (body.action === 'tag_photo') {
    const { photo_id, child_id } = body
    if (!photo_id || !child_id) {
      return NextResponse.json({ error: 'photo_id и child_id обязательны' }, { status: 400 })
    }

    const photo = await getOwnedPhoto(auth, photo_id)
    if (!photo) return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 })
    if (!(await assertChildAccess(auth, child_id))) {
      return NextResponse.json({ error: 'Ученик не найден' }, { status: 404 })
    }

    const { error } = await supabaseAdmin
      .from('photo_children')
      .upsert({ photo_id, child_id }, { onConflict: 'photo_id,child_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'photo.tag', 'photo', photo_id, { child_id })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // untag_photo — убрать привязку фото от ребёнка
  // ----------------------------------------------------------
  if (body.action === 'untag_photo') {
    const { photo_id, child_id } = body
    if (!photo_id || !child_id) {
      return NextResponse.json({ error: 'photo_id и child_id обязательны' }, { status: 400 })
    }

    const photo = await getOwnedPhoto(auth, photo_id)
    if (!photo) return NextResponse.json({ error: 'Фото не найдено' }, { status: 404 })

    await supabaseAdmin
      .from('photo_children')
      .delete()
      .eq('photo_id', photo_id)
      .eq('child_id', child_id)

    await logAction(auth, 'photo.untag', 'photo', photo_id, { child_id })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // import_tags — массовая разметка из CSV
  // rows: [{ child_name, photo_filename }]
  // Имена и имена файлов матчатся по ilike (регистронезависимо).
  // Возвращает { linked, skipped, skipped_rows } для отладки.
  // ----------------------------------------------------------
  if (body.action === 'import_tags') {
    const { album_id, rows } = body
    if (!album_id || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'album_id и rows обязательны' }, { status: 400 })
    }

    if (!(await assertAlbumAccess(auth, album_id))) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }

    // Подтягиваем всех детей и все фото альбома одним запросом —
    // так намного быстрее чем по одному запросу на строку CSV.
    const [childrenRes, photosRes] = await Promise.all([
      supabaseAdmin.from('children').select('id, full_name').eq('album_id', album_id),
      supabaseAdmin.from('photos').select('id, filename').eq('album_id', album_id),
    ])

    const childByName: Record<string, string> = {}
    for (const c of childrenRes.data ?? []) {
      childByName[(c as any).full_name.trim().toLowerCase()] = (c as any).id
    }

    const photoByFilename: Record<string, string> = {}
    for (const p of photosRes.data ?? []) {
      photoByFilename[(p as any).filename.trim().toLowerCase()] = (p as any).id
    }

    let linked = 0
    let skipped = 0
    const skippedRows: Array<{ child_name: string; photo_filename: string; reason: string }> = []
    const inserts: Array<{ photo_id: string; child_id: string }> = []

    for (const row of rows) {
      const childName = (row?.child_name ?? '').toString().trim().toLowerCase()
      const photoName = (row?.photo_filename ?? '').toString().trim().toLowerCase()

      if (!childName || !photoName) { skipped++; continue }

      const childId = childByName[childName]
      const photoId = photoByFilename[photoName]

      if (!childId && !photoId) {
        skipped++
        skippedRows.push({ child_name: row.child_name, photo_filename: row.photo_filename, reason: 'не найдены ни ученик, ни фото' })
        continue
      }
      if (!childId) {
        skipped++
        skippedRows.push({ child_name: row.child_name, photo_filename: row.photo_filename, reason: 'ученик не найден' })
        continue
      }
      if (!photoId) {
        skipped++
        skippedRows.push({ child_name: row.child_name, photo_filename: row.photo_filename, reason: 'фото не найдено' })
        continue
      }

      inserts.push({ photo_id: photoId, child_id: childId })
    }

    // Пачкой делаем upsert (onConflict — игнор дубликатов)
    if (inserts.length > 0) {
      const { error } = await supabaseAdmin
        .from('photo_children')
        .upsert(inserts, { onConflict: 'photo_id,child_id', ignoreDuplicates: true })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      linked = inserts.length
    }

    await logAction(auth, 'photo.import_tags', 'album', album_id, { linked, skipped })

    return NextResponse.json({ linked, skipped, skipped_rows: skippedRows.slice(0, 50) })
  }

  // ----------------------------------------------------------
  // update_lead_status — обновить статус заявки
  // Статусы: new / in_progress / done / rejected
  // ----------------------------------------------------------
  if (body.action === 'update_lead_status') {
    const { id, status } = body
    if (!id || !status) {
      return NextResponse.json({ error: 'id и status обязательны' }, { status: 400 })
    }

    const ALLOWED = ['new', 'in_progress', 'done', 'rejected']
    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: 'Неверный статус' }, { status: 400 })
    }

    // Проверка, что заявка принадлежит tenant'у
    if (auth.role !== 'superadmin') {
      const { data: lead } = await supabaseAdmin
        .from('referral_leads')
        .select('tenant_id')
        .eq('id', id)
        .single()
      if (!lead || (lead as any).tenant_id !== auth.tenantId) {
        return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
      }
    }

    const { error } = await supabaseAdmin
      .from('referral_leads')
      .update({ status })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'lead.update_status', 'lead', id, { status })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_lead — удалить заявку
  // ----------------------------------------------------------
  if (body.action === 'delete_lead') {
    const { id } = body
    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }

    if (auth.role !== 'superadmin') {
      const { data: lead } = await supabaseAdmin
        .from('referral_leads')
        .select('tenant_id')
        .eq('id', id)
        .single()
      if (!lead || (lead as any).tenant_id !== auth.tenantId) {
        return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
      }
    }

    const { error } = await supabaseAdmin
      .from('referral_leads')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'lead.delete', 'lead', id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // invite_user — создать приглашение нового сотрудника
  // Только для owner. Возвращает ссылку приглашения.
  // ----------------------------------------------------------
  if (body.action === 'invite_user') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может приглашать сотрудников' }, { status: 403 })
    }

    const email = (body.email ?? '').toString().toLowerCase().trim()
    const role = (body.role ?? 'manager').toString().trim()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Введите корректный email' }, { status: 400 })
    }

    const ALLOWED_ROLES = ['owner', 'manager', 'viewer']
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Неверная роль' }, { status: 400 })
    }

    // Проверим, нет ли уже такого пользователя в этом tenant'е
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('email', email)
      .maybeSingle()

    if (existingUser) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже есть в вашей команде' },
        { status: 409 }
      )
    }

    // Есть ли активное приглашение на этот email?
    const { data: existingInvite } = await supabaseAdmin
      .from('invitations')
      .select('id, token, expires_at')
      .eq('tenant_id', auth.tenantId)
      .eq('email', email)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existingInvite) {
      return NextResponse.json(
        {
          error: 'На этот email уже есть активное приглашение',
          token: (existingInvite as any).token,
          existing: true,
        },
        { status: 409 }
      )
    }

    // Создаём приглашение. Token и expires_at генерирует БД (default'ы).
    const { data: invitation, error } = await supabaseAdmin
      .from('invitations')
      .insert({
        tenant_id: auth.tenantId,
        email,
        role,
        invited_by: auth.userId,
      })
      .select('id, email, role, token, expires_at, created_at')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'user.invite', 'invitation', (invitation as any).id, {
      email,
      role,
    })

    return NextResponse.json(invitation)
  }

  // ----------------------------------------------------------
  // revoke_invitation — отозвать активное приглашение
  // ----------------------------------------------------------
  if (body.action === 'revoke_invitation') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может отзывать приглашения' }, { status: 403 })
    }

    const { id } = body
    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }

    // Проверка владения
    if (auth.role !== 'superadmin') {
      const { data: inv } = await supabaseAdmin
        .from('invitations')
        .select('tenant_id')
        .eq('id', id)
        .single()
      if (!inv || (inv as any).tenant_id !== auth.tenantId) {
        return NextResponse.json({ error: 'Приглашение не найдено' }, { status: 404 })
      }
    }

    const { error } = await supabaseAdmin
      .from('invitations')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'user.revoke_invitation', 'invitation', id)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // remove_user — удалить/отключить сотрудника
  // Нельзя удалить себя. Нельзя удалить последнего owner'а.
  // Действие — hard delete (вместе с сессиями), т.к. users внутри tenant'а
  // немного. Если передать soft=true — только is_active=false.
  // ----------------------------------------------------------
  if (body.action === 'remove_user') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может удалять сотрудников' }, { status: 403 })
    }

    const { user_id, soft } = body
    if (!user_id) {
      return NextResponse.json({ error: 'user_id обязателен' }, { status: 400 })
    }

    if (user_id === auth.userId) {
      return NextResponse.json({ error: 'Нельзя удалить самого себя' }, { status: 400 })
    }

    // Проверка принадлежности tenant'у
    const { data: target } = await supabaseAdmin
      .from('users')
      .select('tenant_id, role, full_name, email')
      .eq('id', user_id)
      .single()

    if (!target) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }
    if ((target as any).role === 'superadmin') {
      return NextResponse.json({ error: 'Нельзя удалить superadmin' }, { status: 403 })
    }
    if (auth.role !== 'superadmin' && (target as any).tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }

    // Защита от удаления последнего owner'а
    if ((target as any).role === 'owner') {
      const { count: ownersCount } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', (target as any).tenant_id)
        .eq('role', 'owner')
        .eq('is_active', true)

      if ((ownersCount ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Нельзя удалить последнего владельца. Сначала назначьте другого owner.' },
          { status: 400 }
        )
      }
    }

    if (soft) {
      const { error } = await supabaseAdmin
        .from('users')
        .update({ is_active: false })
        .eq('id', user_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // Hard delete — явно сносим связанные данные
      await supabaseAdmin.from('sessions').delete().eq('user_id', user_id)
      // Приглашения invited_by ON DELETE SET NULL — не трогаем
      const { error } = await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', user_id)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAction(auth, soft ? 'user.deactivate' : 'user.delete', 'user', user_id, {
      full_name: (target as any).full_name,
      email: (target as any).email,
      role: (target as any).role,
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // change_role — сменить роль сотрудника
  // Нельзя сменить свою собственную роль.
  // Нельзя оставить tenant без owner'ов.
  // ----------------------------------------------------------
  if (body.action === 'change_role') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может менять роли' }, { status: 403 })
    }

    const { user_id, role } = body
    if (!user_id || !role) {
      return NextResponse.json({ error: 'user_id и role обязательны' }, { status: 400 })
    }

    const ALLOWED = ['owner', 'manager', 'viewer']
    if (!ALLOWED.includes(role)) {
      return NextResponse.json({ error: 'Неверная роль' }, { status: 400 })
    }

    if (user_id === auth.userId) {
      return NextResponse.json(
        { error: 'Нельзя сменить свою собственную роль' },
        { status: 400 }
      )
    }

    const { data: target } = await supabaseAdmin
      .from('users')
      .select('tenant_id, role')
      .eq('id', user_id)
      .single()

    if (!target) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }
    if ((target as any).role === 'superadmin') {
      return NextResponse.json({ error: 'Роль superadmin нельзя менять' }, { status: 403 })
    }
    if (auth.role !== 'superadmin' && (target as any).tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }

    if ((target as any).role === role) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    // Если понижаем последнего owner'а — блокируем
    if ((target as any).role === 'owner' && role !== 'owner') {
      const { count: ownersCount } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', (target as any).tenant_id)
        .eq('role', 'owner')
        .eq('is_active', true)

      if ((ownersCount ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Нельзя понизить последнего владельца. Сначала назначьте другого owner.' },
          { status: 400 }
        )
      }
    }

    const { error } = await supabaseAdmin
      .from('users')
      .update({ role })
      .eq('id', user_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'user.change_role', 'user', user_id, {
      from: (target as any).role,
      to: role,
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // update_tenant_settings — обновить базовые настройки tenant'а
  // Только для owner. Обновляемые поля: name, city, phone, email.
  // Логотип, брендинг, план, лимиты — НЕ здесь (логотип в 3.5.b,
  // план и лимиты меняет только superadmin через /super).
  // ----------------------------------------------------------
  if (body.action === 'update_tenant_settings') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может менять настройки' }, { status: 403 })
    }

    const update: Record<string, any> = {}

    if (body.name !== undefined) {
      const name = body.name.toString().trim()
      if (!name) {
        return NextResponse.json({ error: 'Название не может быть пустым' }, { status: 400 })
      }
      if (name.length > 100) {
        return NextResponse.json({ error: 'Название слишком длинное (макс. 100 символов)' }, { status: 400 })
      }
      update.name = name
    }

    if (body.city !== undefined) {
      update.city = body.city ? body.city.toString().trim() : null
    }

    if (body.phone !== undefined) {
      update.phone = body.phone ? body.phone.toString().trim() : null
    }

    if (body.email !== undefined) {
      const email = body.email ? body.email.toString().trim().toLowerCase() : null
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Неверный формат email' }, { status: 400 })
      }
      update.email = email
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update(update)
      .eq('id', auth.tenantId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'tenant.update_settings', 'tenant', auth.tenantId, {
      fields: Object.keys(update),
    })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // change_password — смена пароля текущего пользователя
  // Доступно всем ролям (owner, manager, viewer).
  // Требует текущий пароль для подтверждения.
  // ----------------------------------------------------------
  if (body.action === 'change_password') {
    if (!auth.userId) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    const current = (body.current_password ?? '').toString()
    const next = (body.new_password ?? '').toString()

    if (!current || !next) {
      return NextResponse.json({ error: 'Укажите текущий и новый пароль' }, { status: 400 })
    }
    if (next.length < 8) {
      return NextResponse.json({ error: 'Новый пароль должен быть не короче 8 символов' }, { status: 400 })
    }
    if (next === current) {
      return NextResponse.json({ error: 'Новый пароль совпадает с текущим' }, { status: 400 })
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, password_hash')
      .eq('id', auth.userId)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })
    }

    const valid = await verifyPassword(current, (user as any).password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Неверный текущий пароль' }, { status: 401 })
    }

    const newHash = await hashPassword(next)

    const { error } = await supabaseAdmin
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', auth.userId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Выкидываем все остальные сессии (кроме текущей —
    // чтобы не разлогинить пользователя, который только что сменил пароль).
    // Упрощение: выкидываем все, пользователь заново залогинится
    // на всех устройствах. Это безопаснее.
    await supabaseAdmin.from('sessions').delete().eq('user_id', auth.userId)

    await logAction(auth, 'user.change_password', 'user', auth.userId)

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // update_branding — обновить брендинг tenant'а
  // Только для owner. Хранит:
  //   tenants.logo_url — в колонке (строка)
  //   tenants.settings — JSONB с ключами:
  //     brand_color — hex-цвет (#rrggbb)
  //     welcome_text — текст приветствия для родителей
  //     footer_text — подпись в письмах
  // ----------------------------------------------------------
  if (body.action === 'update_branding') {
    if (auth.role !== 'owner' && auth.role !== 'superadmin') {
      return NextResponse.json({ error: 'Только владелец может менять брендинг' }, { status: 403 })
    }

    // Сначала читаем текущие settings чтобы мержить
    const { data: current } = await supabaseAdmin
      .from('tenants')
      .select('settings')
      .eq('id', auth.tenantId)
      .single()

    const existingSettings = ((current as any)?.settings ?? {}) as Record<string, any>
    const newSettings = { ...existingSettings }

    // brand_color — hex-цвет
    if (body.brand_color !== undefined) {
      const color = body.brand_color ? body.brand_color.toString().trim() : ''
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return NextResponse.json(
          { error: 'Цвет должен быть в формате #RRGGBB' },
          { status: 400 }
        )
      }
      if (color) {
        newSettings.brand_color = color.toLowerCase()
      } else {
        delete newSettings.brand_color
      }
    }

    // welcome_text
    if (body.welcome_text !== undefined) {
      const text = body.welcome_text ? body.welcome_text.toString() : ''
      if (text.length > 1000) {
        return NextResponse.json(
          { error: 'Текст приветствия слишком длинный (макс. 1000 символов)' },
          { status: 400 }
        )
      }
      if (text.trim()) {
        newSettings.welcome_text = text
      } else {
        delete newSettings.welcome_text
      }
    }

    // footer_text
    if (body.footer_text !== undefined) {
      const text = body.footer_text ? body.footer_text.toString() : ''
      if (text.length > 500) {
        return NextResponse.json(
          { error: 'Подпись слишком длинная (макс. 500 символов)' },
          { status: 400 }
        )
      }
      if (text.trim()) {
        newSettings.footer_text = text
      } else {
        delete newSettings.footer_text
      }
    }

    const update: Record<string, any> = { settings: newSettings }

    // Удаление логотипа — передают logo_url: null
    if (body.logo_url === null) {
      // Читаем текущий logo_url чтобы удалить файл
      const { data: tenantRow } = await supabaseAdmin
        .from('tenants')
        .select('logo_url')
        .eq('id', auth.tenantId)
        .single()
      const oldPath = (tenantRow as any)?.logo_url
      if (oldPath) {
        // oldPath — это путь в bucket'е photos, удаляем файл
        await supabaseAdmin.storage.from('photos').remove([oldPath])
      }
      update.logo_url = null
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update(update)
      .eq('id', auth.tenantId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'tenant.update_branding', 'tenant', auth.tenantId, {
      fields: Object.keys(body).filter(k => k !== 'action'),
    })

    return NextResponse.json({ ok: true, settings: newSettings })
  }

  // ----------------------------------------------------------
  // create_quote — создать свою цитату
  // ----------------------------------------------------------
  if (body.action === 'create_quote') {
    const text = (body.text ?? '').toString().trim()
    const category = (body.category ?? 'general').toString().trim() || 'general'

    if (!text) {
      return NextResponse.json({ error: 'Текст цитаты обязателен' }, { status: 400 })
    }
    if (text.length > 500) {
      return NextResponse.json({ error: 'Цитата слишком длинная (макс. 500 символов)' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('quotes')
      .insert({
        tenant_id: auth.tenantId,
        text,
        category,
      })
      .select('id, text, category, tenant_id, created_at')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'quote.create', 'quote', (data as any).id, { category })

    return NextResponse.json({
      id: (data as any).id,
      text: (data as any).text,
      category: (data as any).category,
      is_global: false,
      created_at: (data as any).created_at,
      use_count: 0,
    })
  }

  // ----------------------------------------------------------
  // update_quote — обновить свою цитату
  // Глобальные цитаты (tenant_id=null) редактировать нельзя.
  // ----------------------------------------------------------
  if (body.action === 'update_quote') {
    const { id } = body
    const text = (body.text ?? '').toString().trim()
    const category = (body.category ?? 'general').toString().trim() || 'general'

    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }
    if (!text) {
      return NextResponse.json({ error: 'Текст цитаты обязателен' }, { status: 400 })
    }
    if (text.length > 500) {
      return NextResponse.json({ error: 'Цитата слишком длинная (макс. 500 символов)' }, { status: 400 })
    }

    // Проверяем владение
    const { data: existing } = await supabaseAdmin
      .from('quotes')
      .select('tenant_id')
      .eq('id', id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
    }
    if ((existing as any).tenant_id === null) {
      return NextResponse.json({ error: 'Глобальные цитаты нельзя редактировать' }, { status: 403 })
    }
    if (auth.role !== 'superadmin' && (existing as any).tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
    }

    const { error } = await supabaseAdmin
      .from('quotes')
      .update({ text, category })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'quote.update', 'quote', id, { category })

    return NextResponse.json({ ok: true })
  }

  // ----------------------------------------------------------
  // delete_quote — удалить свою цитату
  // Глобальные цитаты удалить нельзя через /api/tenant.
  // Если цитата уже выбрана детьми — возвращаем 409 с use_count.
  // ----------------------------------------------------------
  if (body.action === 'delete_quote') {
    const { id, force } = body
    if (!id) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('quotes')
      .select('tenant_id')
      .eq('id', id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
    }
    if ((existing as any).tenant_id === null) {
      return NextResponse.json({ error: 'Глобальные цитаты нельзя удалять' }, { status: 403 })
    }
    if (auth.role !== 'superadmin' && (existing as any).tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
    }

    // Проверим, выбрана ли цитата где-то
    const { count: useCount } = await supabaseAdmin
      .from('quote_selections')
      .select('id', { count: 'exact', head: true })
      .eq('quote_id', id)

    if ((useCount ?? 0) > 0 && !force) {
      return NextResponse.json(
        {
          error: `Цитата уже выбрана ${useCount} учениками. Передайте force=true для принудительного удаления — у них выбор сбросится.`,
          use_count: useCount,
          requires_force: true,
        },
        { status: 409 }
      )
    }

    // force=true → удаляем selections каскадно
    if ((useCount ?? 0) > 0) {
      await supabaseAdmin.from('quote_selections').delete().eq('quote_id', id)
    }

    const { error } = await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAction(auth, 'quote.delete', 'quote', id, {
      had_selections: useCount ?? 0,
      force: !!force,
    })

    return NextResponse.json({ ok: true, reset_selections: useCount ?? 0 })
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
