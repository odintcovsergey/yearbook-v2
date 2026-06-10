import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-error'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { token, quote_id } = await req.json()
  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })

  const { data: child } = await supabaseAdmin
    .from('children').select('id, album_id').eq('access_token', token).single()
  if (!child) return NextResponse.json({ error: 'Не найден' }, { status: 404 })

  // Удалить предыдущий выбор этого ребёнка
  await supabaseAdmin.from('quote_selections').delete().eq('child_id', child.id)

  if (!quote_id) return NextResponse.json({ ok: true })

  // B1: цитата должна быть партнёра этого альбома или глобальной (tenant_id IS NULL).
  const { data: album } = await supabaseAdmin
    .from('albums').select('tenant_id').eq('id', child.album_id).single()
  const { data: quote } = await supabaseAdmin
    .from('quotes').select('id, tenant_id').eq('id', quote_id).maybeSingle()
  if (!quote) return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
  if ((quote as any).tenant_id !== null && (quote as any).tenant_id !== (album as any)?.tenant_id) {
    return NextResponse.json({ error: 'Цитата не найдена' }, { status: 404 })
  }

  // Проверить не занята ли цитата другим
  const { data: taken } = await supabaseAdmin
    .from('quote_selections')
    .select('id')
    .eq('quote_id', quote_id)
    .eq('album_id', child.album_id)
    .neq('child_id', child.id)
    .maybeSingle()

  if (taken) return NextResponse.json({ error: 'Эта цитата уже выбрана другим учеником' }, { status: 409 })

  const { error } = await supabaseAdmin.from('quote_selections').insert({
    quote_id, child_id: child.id, album_id: child.album_id
  })
  if (error) return serverError(error, 'quote')

  return NextResponse.json({ ok: true })
}
