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
import type { PrinterConfig, PrinterSheetType, SpineRange } from '@/lib/printers/types'

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

function sanitizeConfig(raw: unknown): { value: PrinterConfig } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'некорректный config' }
  const rawTypes = Array.isArray((raw as { sheet_types?: unknown }).sheet_types)
    ? ((raw as { sheet_types: unknown[] }).sheet_types)
    : []

  const sheet_types: PrinterSheetType[] = []
  const seen = new Set<string>()
  for (const t of rawTypes) {
    if (!t || typeof t !== 'object') return { error: 'некорректный тип листа' }
    const to = t as Record<string, unknown>
    const id = typeof to.id === 'string' && to.id.trim() ? to.id.trim() : null
    const name = typeof to.name === 'string' ? to.name.trim() : ''
    if (!id) return { error: 'у типа листа нет id' }
    if (!name) return { error: 'у типа листа пустое название' }
    if (seen.has(id)) return { error: 'повторяющийся id типа листа' }
    seen.add(id)

    const rawRanges = Array.isArray(to.spine_ranges) ? to.spine_ranges : []
    const spine_ranges: SpineRange[] = []
    for (const r of rawRanges) {
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
    sheet_types.push({ id, name, spine_ranges })
  }

  return { value: { sheet_types } }
}
