import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TEMPLATE_SET_FIELDS =
  'id, name, slug, print_type, is_global, tenant_id, ' +
  'page_width_mm, page_height_mm, spread_width_mm, spread_height_mm, bleed_mm, ' +
  'facing_pages, page_binding, description, cover_preview_url, created_at, updated_at'

const SPREAD_TEMPLATE_FIELDS =
  'id, name, type, is_spread, width_mm, height_mm, ' +
  'placeholders, rules, sort_order, background_url, created_at'

// ============================================================
// GET /api/layout — read-only endpoints для template_sets
// ============================================================
// Действия:
// - ?action=template_sets — список доступных tenant'у шаблонов.
// - ?action=template_set_detail&id=<uuid> — один template_set + его spread_templates.
//
// Видимость:
// - superadmin без ?tenant_id — видит ВСЕ template_sets.
// - superadmin с ?tenant_id=<uuid> — global + указанный tenant.
// - owner/manager/viewer — global + свой tenant. ?tenant_id молча игнорируется.
//
// Audit log на read-операции не пишем (договорённость по проекту).
// ============================================================

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager', 'viewer'])
  if (isAuthError(auth)) return auth

  const action = req.nextUrl.searchParams.get('action')
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  if (action === 'template_sets') {
    const overrideTenantId = req.nextUrl.searchParams.get('tenant_id')

    let query = supabaseAdmin
      .from('template_sets')
      .select(TEMPLATE_SET_FIELDS)
      .order('is_global', { ascending: false })
      .order('name', { ascending: true })
      .limit(500)

    if (auth.role === 'superadmin') {
      if (overrideTenantId) {
        if (!UUID_REGEX.test(overrideTenantId)) {
          return NextResponse.json({ error: 'invalid tenant_id' }, { status: 400 })
        }
        query = query.or(`tenant_id.is.null,tenant_id.eq.${overrideTenantId}`)
      }
    } else {
      query = query.or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data ?? [])
  }

  if (action === 'template_set_detail') {
    const id = req.nextUrl.searchParams.get('id')
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'valid id required' }, { status: 400 })
    }

    let setQuery = supabaseAdmin
      .from('template_sets')
      .select(TEMPLATE_SET_FIELDS)
      .eq('id', id)

    if (auth.role !== 'superadmin') {
      setQuery = setQuery.or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
    }

    const { data: templateSet, error: setError } = await setQuery.maybeSingle()
    if (setError) {
      return NextResponse.json({ error: setError.message }, { status: 500 })
    }
    if (!templateSet) {
      return NextResponse.json({ error: 'Template set not found' }, { status: 404 })
    }

    const { data: spreadTemplates, error: spreadsError } = await supabaseAdmin
      .from('spread_templates')
      .select(SPREAD_TEMPLATE_FIELDS)
      .eq('template_set_id', id)
      .order('sort_order', { ascending: true })

    if (spreadsError) {
      return NextResponse.json({ error: spreadsError.message }, { status: 500 })
    }

    return NextResponse.json({
      template_set: templateSet,
      spread_templates: spreadTemplates ?? [],
    })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
