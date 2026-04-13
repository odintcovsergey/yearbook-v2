import { NextRequest, NextResponse } from 'next/server'
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
