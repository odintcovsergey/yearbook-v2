/**
 * API типографий (ТЗ tz-printer-entity). Только супер-админ.
 *
 * Типография = строка printers с config.sheet_types[].spine_ranges (диапазоны
 * «от N до M разворотов → корешок мм»). Расчёт корешка — lib/printers/spine.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-error'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction, type AuthContext } from '@/lib/auth'
import type {
  PrinterConfig,
  PrinterSheetType,
  PrinterFormat,
  PrinterSpine,
  SpineRange,
  AcceptMode,
  FileFormat,
  FormatFamily,
} from '@/lib/printers/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── GET: список глобальных типографий ──────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const { data, error } = await supabaseAdmin
    .from('printers')
    .select('id, tenant_id, is_global, name, config')
    .is('tenant_id', null)
    .order('name')
  if (error) return serverError(error, 'printers')
  return NextResponse.json({ printers: data ?? [] })
}

// ─── POST: создать / обновить / удалить ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')
  if (action === 'create') return handleCreate(req, auth)
  if (action === 'update') return handleUpdate(req, auth)
  if (action === 'delete') return handleDelete(req, auth)
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

async function handleCreate(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'нужно название типографии' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('printers')
    .insert({ tenant_id: null, is_global: true, name, config: { sheet_types: [] } })
    .select('id')
    .single()
  if (error || !data) return serverError(error ?? new Error('no row'), 'printers')

  await logAction(auth, 'printer.create', 'printer', (data as { id: string }).id, { name })
  return NextResponse.json({ ok: true, id: (data as { id: string }).id })
}

async function handleUpdate(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const id = body.id
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'пустое название' }, { status: 400 })
    patch.name = name
  }
  if (body.config !== undefined) {
    const parsed = sanitizeConfig(body.config)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    patch.config = parsed.value
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'нечего обновлять' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('printers').update(patch).eq('id', id).is('tenant_id', null)
  if (error) return serverError(error, 'printers')
  await logAction(auth, 'printer.update', 'printer', id, {})
  return NextResponse.json({ ok: true })
}

async function handleDelete(req: NextRequest, auth: AuthContext): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const id = body.id
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('printers').delete().eq('id', id).is('tenant_id', null)
  if (error) return serverError(error, 'printers')
  await logAction(auth, 'printer.delete', 'printer', id, {})
  return NextResponse.json({ ok: true })
}

// ─── Валидация config ───────────────────────────────────────────────────────

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : null
}

const FAMILIES: FormatFamily[] = ['vertical_rect', 'square', 'horizontal']

/** Валидирует один диапазон корешка. */
function sanitizeRanges(rawRanges: unknown, name: string): { value: SpineRange[] } | { error: string } {
  const list = Array.isArray(rawRanges) ? rawRanges : []
  const spine_ranges: SpineRange[] = []
  for (const r of list) {
    if (!r || typeof r !== 'object') return { error: `некорректный диапазон у «${name}»` }
    const ro = r as Record<string, unknown>
    const min = num(ro.min_spreads)
    const max = num(ro.max_spreads)
    const spine = num(ro.spine_mm)
    if (min === null || max === null || spine === null) return { error: `заполни диапазон у «${name}»` }
    if (min < 0 || max < min) return { error: `у «${name}»: «до» должно быть ≥ «от»` }
    if (spine < 0) return { error: `у «${name}»: корешок не может быть отрицательным` }
    spine_ranges.push({ min_spreads: Math.round(min), max_spreads: Math.round(max), spine_mm: spine })
  }
  return { value: spine_ranges }
}

/** Валидирует режим корешка типа листа (ranges/formula/fixed), с legacy-фолбэком. */
function sanitizeSpine(to: Record<string, unknown>, name: string): { value: PrinterSpine } | { error: string } {
  // legacy: только spine_ranges, без spine → mode='ranges'
  const rawSpine = (to.spine && typeof to.spine === 'object') ? (to.spine as Record<string, unknown>) : null
  if (!rawSpine) {
    const r = sanitizeRanges(to.spine_ranges, name)
    if ('error' in r) return r
    return { value: { mode: 'ranges', ranges: r.value } }
  }

  const mode = rawSpine.mode
  if (mode === 'formula') {
    const f = (rawSpine.formula && typeof rawSpine.formula === 'object') ? (rawSpine.formula as Record<string, unknown>) : {}
    const base = num(f.base_mm)
    const step = num(f.step_mm)
    const per = num(f.per_spreads)
    if (base === null || step === null || per === null) return { error: `заполни формулу корешка у «${name}»` }
    if (base < 0 || step < 0) return { error: `у «${name}»: значения формулы не могут быть отрицательными` }
    if (per <= 0) return { error: `у «${name}»: «на N разворотов» должно быть > 0` }
    return { value: { mode: 'formula', formula: { base_mm: base, step_mm: step, per_spreads: per } } }
  }
  if (mode === 'fixed') {
    const fixed = num(rawSpine.fixed_mm)
    if (fixed === null) return { error: `заполни фикс. корешок у «${name}»` }
    if (fixed < 0) return { error: `у «${name}»: корешок не может быть отрицательным` }
    return { value: { mode: 'fixed', fixed_mm: fixed } }
  }
  // 'ranges' или неизвестное → ranges
  const r = sanitizeRanges(rawSpine.ranges ?? to.spine_ranges, name)
  if ('error' in r) return r
  return { value: { mode: 'ranges', ranges: r.value } }
}

/** Валидирует один формат блока. */
function sanitizeFormat(raw: unknown): { value: PrinterFormat } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'некорректный формат' }
  const fo = raw as Record<string, unknown>
  const id = typeof fo.id === 'string' && fo.id.trim() ? fo.id.trim() : null
  const name = typeof fo.name === 'string' ? fo.name.trim() : ''
  if (!id) return { error: 'у формата нет id' }
  if (!name) return { error: 'у формата пустое название' }
  const family = (typeof fo.family === 'string' && FAMILIES.includes(fo.family as FormatFamily))
    ? (fo.family as FormatFamily) : 'vertical_rect'
  const n = (k: string) => num(fo[k]) ?? 0
  for (const k of ['page_w_mm', 'page_h_mm', 'work_w_mm', 'work_h_mm', 'bleed_mm', 'safe_mm', 'spread_w_px', 'spread_h_px']) {
    const v = num(fo[k])
    if (v !== null && v < 0) return { error: `у формата «${name}»: «${k}» не может быть отрицательным` }
  }
  return {
    value: {
      id, name, family,
      page_w_mm: n('page_w_mm'), page_h_mm: n('page_h_mm'),
      spread_w_px: Math.round(n('spread_w_px')), spread_h_px: Math.round(n('spread_h_px')),
      work_w_mm: n('work_w_mm'), work_h_mm: n('work_h_mm'),
      bleed_mm: n('bleed_mm'), safe_mm: n('safe_mm'),
    },
  }
}

function sanitizeConfig(raw: unknown): { value: PrinterConfig } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'некорректный config' }
  const ro = raw as Record<string, unknown>

  // ── Типы листов ──
  const rawTypes = Array.isArray(ro.sheet_types) ? ro.sheet_types : []
  const sheet_types: PrinterSheetType[] = []
  const seenT = new Set<string>()
  for (const t of rawTypes) {
    if (!t || typeof t !== 'object') return { error: 'некорректный тип листа' }
    const to = t as Record<string, unknown>
    const id = typeof to.id === 'string' && to.id.trim() ? to.id.trim() : null
    const name = typeof to.name === 'string' ? to.name.trim() : ''
    if (!id) return { error: 'у типа листа нет id' }
    if (!name) return { error: 'у типа листа пустое название' }
    if (seenT.has(id)) return { error: 'повторяющийся id типа листа' }
    seenT.add(id)
    const spine = sanitizeSpine(to, name)
    if ('error' in spine) return { error: spine.error }
    sheet_types.push({ id, name, spine: spine.value })
  }

  // ── Форматы ──
  const rawFormats = Array.isArray(ro.formats) ? ro.formats : []
  const formats: PrinterFormat[] = []
  const seenF = new Set<string>()
  for (const f of rawFormats) {
    const r = sanitizeFormat(f)
    if ('error' in r) return { error: r.error }
    if (seenF.has(r.value.id)) return { error: 'повторяющийся id формата' }
    seenF.add(r.value.id)
    formats.push(r.value)
  }

  // ── Прочие поля профиля ──
  const accept_mode: AcceptMode = ro.accept_mode === 'page' ? 'page' : 'spread'
  const file_format: FileFormat = ro.file_format === 'pdf' ? 'pdf' : 'jpeg'
  const color = typeof ro.color === 'string' && ro.color.trim() ? ro.color.trim() : 'srgb'

  const value: PrinterConfig = { sheet_types, formats, accept_mode, file_format, color }

  // ── Загибы обложки ──
  if (ro.cover && typeof ro.cover === 'object') {
    const co = ro.cover as Record<string, unknown>
    const lr = num(co.flap_lr_mm)
    const tb = num(co.flap_tb_mm)
    if (lr !== null || tb !== null) {
      if ((lr ?? 0) < 0 || (tb ?? 0) < 0) return { error: 'загибы обложки не могут быть отрицательными' }
      value.cover = { flap_lr_mm: lr ?? 0, flap_tb_mm: tb ?? 0 }
    }
  }

  return { value }
}
