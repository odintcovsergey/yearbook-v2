import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — info about referrer for landing page
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })

  const { data: child } = await supabaseAdmin
    .from('children')
    .select('id, full_name, album_id')
    .eq('access_token', token)
    .single()

  if (!child) return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 404 })

  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('title, city, year')
    .eq('id', child.album_id)
    .single()

  // Get parent name if available
  const { data: contact } = await supabaseAdmin
    .from('parent_contacts')
    .select('parent_name')
    .eq('child_id', child.id)
    .maybeSingle()

  return NextResponse.json({
    referrerName: contact?.parent_name || child.full_name,
    albumTitle: album?.title,
    city: album?.city,
  })
}

// POST — save new lead
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { token, name, phone, school, class_name } = body

  if (!token || !name?.trim() || !phone?.trim())
    return NextResponse.json({ error: 'Заполните имя и телефон' }, { status: 400 })

  const { data: child } = await supabaseAdmin
    .from('children')
    .select('id')
    .eq('access_token', token)
    .single()

  if (!child) return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 404 })

  const { error } = await supabaseAdmin.from('referral_leads').insert({
    referrer_child_id: child.id,
    name: name.trim(),
    phone: phone.trim(),
    school: school?.trim() || null,
    class_name: class_name?.trim() || null,
    status: 'new',
  })

  if (error) return NextResponse.json({ error: 'Ошибка сохранения' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
