import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const albumId = req.nextUrl.searchParams.get('album_id')
  if (!albumId) return NextResponse.json({ error: 'Нет album_id' }, { status: 400 })

  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('id, title, deadline')
    .eq('id', albumId)
    .single()

  if (!album) return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })

  if (album.deadline && new Date(album.deadline) < new Date())
    return NextResponse.json({ error: 'Срок выбора фотографий истёк.' }, { status: 410 })

  const { data: children } = await supabaseAdmin
    .from('children')
    .select('id, full_name, class, access_token, submitted_at')
    .eq('album_id', albumId)
    .order('class').order('full_name')

  return NextResponse.json(
    { title: album.title, children: children ?? [] },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
// cache bust четверг,  9 апреля 2026 г. 16:13:02 (+04)
