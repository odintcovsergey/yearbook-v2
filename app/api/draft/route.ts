import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — загрузить черновик
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json(null)

  const { data: child } = await supabaseAdmin
    .from('children').select('id').eq('access_token', token).single()
  if (!child) return NextResponse.json(null)

  const { data } = await supabaseAdmin
    .from('drafts').select('data').eq('child_id', child.id).maybeSingle()

  return NextResponse.json(data?.data ?? null)
}

// POST — сохранить черновик
export async function POST(req: NextRequest) {
  const { token, data } = await req.json()
  if (!token) return NextResponse.json({ error: 'Нет токена' }, { status: 400 })

  const { data: child } = await supabaseAdmin
    .from('children').select('id').eq('access_token', token).single()
  if (!child) return NextResponse.json({ error: 'Не найден' }, { status: 404 })

  await supabaseAdmin.from('drafts').upsert(
    { child_id: child.id, data, updated_at: new Date().toISOString() },
    { onConflict: 'child_id' }
  )

  // Отметить что родитель начал заполнение
  await supabaseAdmin.from('children')
    .update({ started_at: new Date().toISOString() })
    .eq('id', child.id)
    .is('started_at', null)

  return NextResponse.json({ ok: true })
}
