import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret')
  if (secret !== process.env.ADMIN_SECRET)
    return NextResponse.json({ error: 'Нет доступа' }, { status: 401 })

  const { album_id, filename, storage_path, type } = await req.json()

  if (!album_id || !filename || !storage_path || !type)
    return NextResponse.json({ error: 'Не хватает данных' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('photos')
    .insert({ album_id, filename, storage_path, type })
    .select()
    .single()

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
